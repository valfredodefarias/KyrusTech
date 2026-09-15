# app/services/pdv/cartao_service.py
from __future__ import annotations
import calendar
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from fastapi import HTTPException
from sqlmodel import Session, select, col

from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.entidade import Entidade
from app.models.regra_cartao import RegraCartao
from app.models.plano_contas import PlanoContas
from app.models.pdv_movimentacao import PdvMovimentacao


def obter_conta_caixa_fisica(db: Session, empresa_id: int) -> int:
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    # 1. Tipo CAIXA e nome contendo "caixa" ou "física"
    for c in contas:
        if c.tipo.upper() == "CAIXA" and "caixa" in c.nome.lower():
            return c.id
    # 2. Tipo CAIXA
    for c in contas:
        if c.tipo.upper() == "CAIXA":
            return c.id
    # 3. Nome contendo "caixa"
    for c in contas:
        if "caixa" in c.nome.lower():
            return c.id
    # 4. Criar conta padrão se nenhuma existir
    nova_conta = Conta(
        nome="Caixa Física",
        tipo="CAIXA",
        saldo_inicial=Decimal("0.00"),
        status="ATIVO",
        empresa_id=empresa_id,
        conta_como_disponibilidade=True
    )
    db.add(nova_conta)
    db.flush()
    return nova_conta.id


def calcular_vencimento_dia_fixo(base_date: date, dia_fixo: int) -> date:
    # Se a data atual já passou do dia fixo, vai para o próximo mês
    if base_date.day < dia_fixo:
        try:
            return base_date.replace(day=dia_fixo)
        except ValueError:
            pass
    
    # Próximo mês
    year = base_date.year + (base_date.month // 12)
    month = (base_date.month % 12) + 1
    last_day = calendar.monthrange(year, month)[1]
    target_day = min(dia_fixo, last_day)
    return date(year, month, target_day)


def adicionar_dias_uteis(start_date: date, days: int) -> date:
    current_date = start_date
    added_days = 0
    while added_days < days:
        current_date += timedelta(days=1)
        if current_date.weekday() < 5:  # Segunda a Sexta
            added_days += 1
    return current_date


def calcular_payout_date(base_date: date, regra: RegraCartao) -> date:
    # 1. Calcular data base com tipo de prazo
    if regra.tipo_prazo == "DIA_FIXO_MES" and regra.dia_fixo:
        vencimento = calcular_vencimento_dia_fixo(base_date, regra.dia_fixo)
    elif regra.tipo_prazo == "DIA_FIXO_SEMANA" and regra.dia_fixo is not None:
        vencimento = base_date + timedelta(days=regra.dias_payout)
        days_to_target = (regra.dia_fixo - vencimento.weekday()) % 7
        vencimento = vencimento + timedelta(days=days_to_target)
    elif regra.tipo_prazo == "DIAS_UTEIS":
        vencimento = adicionar_dias_uteis(base_date, regra.dias_payout)
    else:  # DIAS_CORRIDOS
        vencimento = base_date + timedelta(days=regra.dias_payout)
        
    # 2. Rolar para o próximo dia útil se cair no final de semana (exceto se for dia fixo da semana)
    if regra.tipo_prazo != "DIA_FIXO_SEMANA":
        if regra.fds_proximo_dia_util and vencimento.weekday() >= 5:
            days_to_add = 7 - vencimento.weekday()
            vencimento = vencimento + timedelta(days=days_to_add)
        
    return vencimento


def shift_months(base_date: date, months: int) -> date:
    if months == 0:
        return base_date
    year = base_date.year + (base_date.month - 1 + months) // 12
    month = (base_date.month - 1 + months) % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(base_date.day, last_day)
    return date(year, month, day)


def obter_categoria_pagamento(
    db: Session,
    empresa_id: int,
    tipo_pagamento: str,
    config_categorias: dict,
    plano_fallback_id: int
) -> int:
    plano_id_str = config_categorias.get(tipo_pagamento)
    if plano_id_str:
        try:
            return int(plano_id_str)
        except ValueError:
            pass

    tipo_pagamento_lower = tipo_pagamento.lower()
    search_terms = []
    if "debito" in tipo_pagamento_lower:
        search_terms = ["débito", "debito"]
    elif "credito" in tipo_pagamento_lower:
        search_terms = ["crédito", "credito"]
    elif "pix" in tipo_pagamento_lower:
        search_terms = ["pix"]
    elif "dinheiro" in tipo_pagamento_lower:
        search_terms = ["dinheiro", "caixa"]
    elif "boleto" in tipo_pagamento_lower:
        search_terms = ["boleto"]

    if search_terms:
        categorias = db.exec(
            select(PlanoContas)
            .where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.tipo == "R",
                PlanoContas.eh_cabecalho == False,
                PlanoContas.is_deleted == False
            )
        ).all()

        for cat in categorias:
            nome_normalizado = cat.nome.lower()
            if any(term in nome_normalizado for term in search_terms):
                return int(cat.id)

    return plano_fallback_id


def obter_regra_cartao(
    db: Session,
    empresa_id: int,
    tipo_pagamento: str,
    bandeira: str,
    centro_custo_id: Optional[int] = None,
    data_venda: Optional[date] = None
) -> Optional[RegraCartao]:
    bandeira_upper = bandeira.upper() if bandeira else "OUTROS"
    
    # Normalizar tipo_pagamento para alinhar com os enums de RegraCartao
    tipo_norm = tipo_pagamento.upper() if tipo_pagamento else ""
    if tipo_pagamento and tipo_pagamento.lower() in ["cartao_credito_vista", "credito_vista"]:
        tipo_norm = "CREDITO_AVISTA"
    elif tipo_pagamento and tipo_pagamento.lower() in ["cartao_credito_parcelado", "credito_parcelado"]:
        tipo_norm = "CREDITO_PARCELADO"
    elif tipo_pagamento and tipo_pagamento.lower() in ["cartao_debito", "debito"]:
        tipo_norm = "DEBITO"
        
    def _get_rule(b: str, cc_id: Optional[int]) -> Optional[RegraCartao]:
        from sqlalchemy import or_
        query = select(RegraCartao).where(
            RegraCartao.empresa_id == empresa_id,
            RegraCartao.tipo_pagamento.in_([tipo_pagamento, tipo_norm]),
            RegraCartao.bandeira == b,
            RegraCartao.is_deleted == False
        )
        if cc_id is not None:
            query = query.where(RegraCartao.centro_custo_id == cc_id)
        else:
            query = query.where(RegraCartao.centro_custo_id == None)
            
        if data_venda:
            query = query.where(
                or_(
                    RegraCartao.data_inicio == None,
                    RegraCartao.data_inicio <= data_venda
                )
            )
        
        # O mais recente válido ganha. Regras sem data_inicio (None) ficam pro final.
        query = query.order_by(RegraCartao.data_inicio.desc().nulls_last())
        return db.exec(query).first()

    # 1. Tentar correspondência exata: tipo, bandeira e centro de custo
    if centro_custo_id:
        regra = _get_rule(bandeira_upper, centro_custo_id)
        if regra: return regra

    # 2. Tentar tipo e bandeira, sem centro de custo (centro_custo_id = None)
    regra = _get_rule(bandeira_upper, None)
    if regra: return regra

    # 3. Tentar tipo e bandeira "OUTROS" com centro de custo
    if centro_custo_id and bandeira_upper != "OUTROS":
        regra = _get_rule("OUTROS", centro_custo_id)
        if regra: return regra

    # 4. Tentar tipo e bandeira "OUTROS" sem centro de custo
    if bandeira_upper != "OUTROS":
        regra = _get_rule("OUTROS", None)
        if regra: return regra
        
    return None


def format_card_description(bandeira: str, tipo_pagamento: str) -> str:
    brand = (bandeira or "Outros").strip().upper()
    if brand == "MASTERCARD":
        brand = "Master"
    elif brand == "AMERICAN EXPRESS":
        brand = "Amex"
    else:
        brand = brand.title()
        
    tp = (tipo_pagamento or "").lower()
    if "debito" in tp or "debit" in tp:
        modality = "Debito"
    else:
        modality = "Credito"
        
    return f"{brand} {modality}"


def adicionar_ou_atualizar_recebivel_cartao_agrupado(
    db: Session,
    empresa_id: int,
    venda_id: str,
    vencimento: date,
    valor: Decimal,
    formatted_desc: str,
    plano_id: int,
    conta_id: Optional[int],
    centro_custo_id: Optional[int],
    hoje_pag: date,
    bandeira: str,
    modality: str,
    current_user_id: int,
    venda_rv: Optional[str] = None,
    vendedor_nome: Optional[str] = None,
    cliente_nome: Optional[str] = None,
) -> None:
    # Obter ou criar entidade "Recebimento Cartões"
    entidade_nome = "Recebimento Cartões"
    entidade = db.exec(
        select(Entidade)
        .where(
            Entidade.empresa_id == empresa_id,
            Entidade.nome == entidade_nome
        )
    ).first()
    
    if not entidade:
        entidade = Entidade(
            nome=entidade_nome,
            empresa_id=empresa_id,
            tipo="AMBOS",
            tipo_pessoa="PJ",
            status="ATIVO",
            created_by_id=current_user_id,
            updated_by_id=current_user_id
        )
        db.add(entidade)
        db.flush()

    target_vencimento = vencimento

    l = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.tipo == "RECEITA",
            Lancamento.data_vencimento == target_vencimento,
            Lancamento.descricao == formatted_desc,
            Lancamento.centro_custo_id == centro_custo_id,
            Lancamento.origem == "PDV",
            Lancamento.is_deleted == False
        )
    ).first()
    
    val_bruto_venda = Decimal(str(valor))
    tipo_pag_lower = "cartao_debito" if (modality.lower() == "debito" or "debito" in formatted_desc.lower()) else "cartao_credito_vista"
    regra = obter_regra_cartao(db, empresa_id, tipo_pag_lower, bandeira, centro_custo_id)
    fee_pct = regra.taxa_porcentagem if regra else Decimal("0.00")
    val_taxa_venda = (val_bruto_venda * fee_pct / Decimal("100")).quantize(Decimal("0.01"))
    val_liquido_venda = val_bruto_venda - val_taxa_venda

    if l:
        if l.status == "PAGO" and l.conta_id is not None:
            conta = db.get(Conta, l.conta_id)
            nome_conta = conta.nome if conta else "Banco"
            raise HTTPException(
                status_code=400,
                detail=f"Não é possível adicionar a venda. O recebível agrupado '{formatted_desc}' para o dia {target_vencimento.strftime('%d/%m/%Y')} já foi liquidado no banco '{nome_conta}'."
            )
        
        # Apenas soma o valor líquido da nova venda ao valor_previsto existente
        l.valor_previsto += val_liquido_venda
        l.entidade_id = entidade.id
        l.updated_by_id = current_user_id
        l.updated_at = datetime.utcnow()
        db.add(l)
    else:
        meta = {
            "grouped_card_launch": True,
            "bandeira": bandeira,
            "modalidade": modality
        }
        
        l = Lancamento(
            descricao=formatted_desc,
            tipo="RECEITA",
            status="EM ABERTO",
            origem="PDV",
            valor_previsto=val_liquido_venda,
            valor_pago=Decimal("0.00"),
            valor_juros=Decimal("0.00"),
            valor_desconto=Decimal("0.00"),
            valor_multa=Decimal("0.00"),
            data_vencimento=target_vencimento,
            data_competencia=target_vencimento,
            empresa_id=empresa_id,
            plano_contas_id=plano_id,
            conta_id=conta_id,
            entidade_id=entidade.id,
            centro_custo_id=centro_custo_id,
            observacao=json.dumps(meta),
            is_deleted=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(l)


def remover_contribuicoes_venda(db: Session, empresa_id: int, venda_id: str, current_user_id: int) -> None:
    # 1. Buscar os lançamentos individuais da venda
    individual_launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.id_parcelamento == venda_id
        )
    ).all()
    
    for l in individual_launches:
        if l.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Esta venda possui parcelas que já foram conciliadas no extrato e não pode ser editada."
            )

    # Validar e remover PdvMovimentacao associadas
    movs_venda = db.exec(
        select(PdvMovimentacao)
        .where(
            PdvMovimentacao.venda_id == venda_id,
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False
        )
    ).all()
    for m in movs_venda:
        if m.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Esta venda possui recebíveis de cartão que já foram conciliados e não pode ser editada."
            )
        m.is_deleted = True
        m.deleted_at = datetime.utcnow()
        m.deleted_by_id = current_user_id
        db.add(m)

    # 2. Buscar lançamentos agrupados que possuem a contribuição desta venda
    grouped_launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            col(Lancamento.observacao).like(f'%"{venda_id}":%')
        )
    ).all()

    for l in grouped_launches:
        if l.status == "PAGO" and l.conta_id is not None:
            conta = db.get(Conta, l.conta_id)
            nome_conta = conta.nome if conta else "Banco"
            raise HTTPException(
                status_code=400,
                detail=f"Esta venda possui recebíveis agrupados de cartão que já foram liquidados (pagos) no banco '{nome_conta}' e não pode ser alterada ou excluída."
            )

    # 3. Marcar individuais como deletados
    for l in individual_launches:
        l.is_deleted = True
        l.deleted_at = datetime.utcnow()
        l.deleted_by_id = current_user_id
        db.add(l)

    # 4. Remover contribuições dos agrupados
    for l in grouped_launches:
        meta = {}
        try:
            meta = json.loads(l.observacao)
        except Exception:
            continue
        
        contribuicoes = meta.get("contribuicoes", {})
        if venda_id in contribuicoes:
            del contribuicoes[venda_id]
            
            total_previsto = sum(
                Decimal(str(item["valor"]))
                for item in contribuicoes.values()
                if isinstance(item, dict) and item.get("status") == "REALIZADO"
            )
            
            if not contribuicoes or total_previsto == Decimal("0.00"):
                l.is_deleted = True
                l.deleted_at = datetime.utcnow()
                l.deleted_by_id = current_user_id
            else:
                l.valor_previsto = total_previsto
                l.observacao = json.dumps(meta)
                l.updated_by_id = current_user_id
                l.updated_at = datetime.utcnow()
            db.add(l)


def atualizar_status_contribuicoes_venda(
    db: Session,
    empresa_id: int,
    venda_id: str,
    novo_status: str,
    current_user_id: int
) -> None:
    # 1. Buscar os lançamentos individuais da venda
    individual_launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            Lancamento.id_parcelamento == venda_id
        )
    ).all()
    
    for l in individual_launches:
        if l.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Esta venda possui parcelas que já foram conciliadas no extrato e o status não pode ser alterado."
            )

    # Validar e atualizar PdvMovimentacao associadas
    movs_venda = db.exec(
        select(PdvMovimentacao)
        .where(
            PdvMovimentacao.venda_id == venda_id,
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False
        )
    ).all()
    for m in movs_venda:
        if m.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Esta venda possui recebíveis de cartão que já foram conciliados e seu status não pode ser alterado."
            )
        if novo_status in ["CANCELADO", "DEVOLVIDO"]:
            m.is_deleted = True
            m.deleted_at = datetime.utcnow()
            m.deleted_by_id = current_user_id
            db.add(m)

    # 2. Buscar lançamentos agrupados que possuem a contribuição desta venda
    grouped_launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            col(Lancamento.observacao).like(f'%"{venda_id}":%')
        )
    ).all()

    for l in grouped_launches:
        if l.status == "PAGO" and l.conta_id is not None:
            conta = db.get(Conta, l.conta_id)
            nome_conta = conta.nome if conta else "Banco"
            raise HTTPException(
                status_code=400,
                detail=f"Esta venda possui recebíveis agrupados de cartão que já foram liquidados (pagos) no banco '{nome_conta}' e não pode ser alterada ou excluída."
            )

    # 3. Atualizar status dos lançamentos individuais
    hoje = date.today()
    from app.models.empresa import Empresa
    empresa = db.get(Empresa, empresa_id)
    pdv_config_dict = {}
    if empresa and empresa.pdv_config:
        try:
            pdv_config_dict = json.loads(empresa.pdv_config)
        except Exception:
            pass
    config_marcar_como_pago = pdv_config_dict.get("marcar_como_pago", {})

    for l in individual_launches:
        meta = {}
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
            except Exception:
                pass
        
        meta["status"] = novo_status
        l.observacao = json.dumps(meta)

        if novo_status == "REALIZADO":
            tipo_pag = meta.get("tipo_pagamento", "dinheiro")
            is_paid = config_marcar_como_pago.get(
                tipo_pag, 
                tipo_pag in ["dinheiro"]
            )
            
            if is_paid:
                l.status = "PAGO"
                l.data_pagamento = hoje
                l.valor_pago = l.valor_previsto
                if not l.conta_id:
                    l.conta_id = obter_conta_caixa_fisica(db, empresa_id)
            else:
                l.status = "EM ABERTO"
                l.data_pagamento = None
                l.valor_pago = Decimal("0.00")
        else:
            l.status = novo_status
            l.data_pagamento = None
            l.valor_pago = Decimal("0.00")
            
        l.updated_by_id = current_user_id
        l.updated_at = datetime.utcnow()
        db.add(l)

    # 4. Atualizar status da contribuição nos agrupados
    for l in grouped_launches:
        meta = {}
        try:
            meta = json.loads(l.observacao)
        except Exception:
            continue
        
        contribuicoes = meta.get("contribuicoes", {})
        if venda_id in contribuicoes:
            if isinstance(contribuicoes[venda_id], dict):
                contribuicoes[venda_id]["status"] = novo_status
            else:
                contribuicoes[venda_id] = {
                    "valor": float(contribuicoes[venda_id]),
                    "status": novo_status
                }
            
            total_previsto = sum(
                Decimal(str(item["valor"]))
                for item in contribuicoes.values()
                if isinstance(item, dict) and item.get("status") == "REALIZADO"
            )
            
            l.valor_previsto = total_previsto
            if total_previsto == Decimal("0.00"):
                l.status = "CANCELADO"
            else:
                if l.status in ["CANCELADO", "DEVOLVIDO"]:
                    l.status = "EM ABERTO"
            
            l.observacao = json.dumps(meta)
            l.updated_by_id = current_user_id
            l.updated_at = datetime.utcnow()
            db.add(l)


def obter_categoria_taxas_cartao(db: Session, empresa_id: int) -> int:
    from app.models.empresa import Empresa
    empresa = db.get(Empresa, empresa_id)
    if empresa and empresa.pdv_config:
        try:
            cfg = json.loads(empresa.pdv_config)
            pc_id = cfg.get("pdv_plano_contas_taxa_cartao_id")
            if pc_id: return int(pc_id)
        except: pass

    pc = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "D",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.is_deleted == False,
            (PlanoContas.nome.ilike("%taxa%cartao%") | PlanoContas.nome.ilike("%tarifa%cartao%"))
        )
    ).first()
    if pc: return pc.id

    pc_fallback = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "D",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.is_deleted == False
        )
    ).first()
    if not pc_fallback:
        raise ValueError(f"A empresa {empresa_id} não possui nenhuma conta de despesa ativa configurada no Plano de Contas.")
    return pc_fallback.id

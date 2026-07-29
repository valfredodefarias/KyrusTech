# app/services/pdv_service.py
from __future__ import annotations
import re
import json
import uuid
import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any
from fastapi import HTTPException
from sqlmodel import Session, select, col, delete

from app.core.cache import clear_transaction_cache
from app.models.lancamento import Lancamento
from app.models.usuario import Usuario
from app.models.produto import Produto
from app.models.plano_contas import PlanoContas
from app.models.empresa import Empresa
from app.models.conta import Conta
from app.models.anexo_lancamento import AnexoLancamento
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.regra_cartao import RegraCartao
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.schemas.pdv import (
    PdvVendaCreate,
    PdvVendaItemRead,
    PdvVendaPagamento
)


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
    centro_custo_id: Optional[int] = None
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

    # 1. Tentar correspondência exata: tipo, bandeira e centro de custo
    if centro_custo_id:
        regra = db.exec(
            select(RegraCartao)
            .where(
                RegraCartao.empresa_id == empresa_id,
                RegraCartao.tipo_pagamento.in_([tipo_pagamento, tipo_norm]),
                RegraCartao.bandeira == bandeira_upper,
                RegraCartao.centro_custo_id == centro_custo_id,
                RegraCartao.is_deleted == False
            )
        ).first()
        if regra:
            return regra

    # 2. Tentar tipo e bandeira, sem centro de custo (centro_custo_id = None)
    regra = db.exec(
        select(RegraCartao)
        .where(
            RegraCartao.empresa_id == empresa_id,
            RegraCartao.tipo_pagamento.in_([tipo_pagamento, tipo_norm]),
            RegraCartao.bandeira == bandeira_upper,
            RegraCartao.centro_custo_id == None,
            RegraCartao.is_deleted == False
        )
    ).first()
    if regra:
        return regra

    # 3. Tentar tipo e bandeira "OUTROS" com centro de custo
    if centro_custo_id and bandeira_upper != "OUTROS":
        regra = db.exec(
            select(RegraCartao)
            .where(
                RegraCartao.empresa_id == empresa_id,
                RegraCartao.tipo_pagamento == tipo_pagamento,
                RegraCartao.bandeira == "OUTROS",
                RegraCartao.centro_custo_id == centro_custo_id,
                RegraCartao.is_deleted == False
            )
        ).first()
        if regra:
            return regra

    # 4. Tentar tipo e bandeira "OUTROS" sem centro de custo
    if bandeira_upper != "OUTROS":
        regra = db.exec(
            select(RegraCartao)
            .where(
                RegraCartao.empresa_id == empresa_id,
                RegraCartao.tipo_pagamento == tipo_pagamento,
                RegraCartao.bandeira == "OUTROS",
                RegraCartao.centro_custo_id == None,
                RegraCartao.is_deleted == False
            )
        ).first()
        if regra:
            return regra

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

    is_debito = (modality.lower() == "debito" or "debito" in formatted_desc.lower())
    target_vencimento = hoje_pag if is_debito else vencimento

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

    if l:
        if l.status == "PAGO" and l.conta_id is not None:
            conta = db.get(Conta, l.conta_id)
            nome_conta = conta.nome if conta else "Banco"
            raise HTTPException(
                status_code=400,
                detail=f"Não é possível adicionar a venda. O recebível agrupado '{formatted_desc}' para o dia {target_vencimento.strftime('%d/%m/%Y')} já foi liquidado no banco '{nome_conta}'."
            )
        
        meta = {}
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
            except Exception:
                pass
        
        contribuicoes = meta.setdefault("contribuicoes", {})
        contribuicoes[venda_id] = {
            "valor": float(valor),
            "rv": venda_rv or "N/A",
            "vendedor": vendedor_nome or "N/A",
            "cliente": cliente_nome or "N/A",
            "status": "REALIZADO"
        }
        
        total_previsto = sum(
            Decimal(str(item["valor"]))
            for item in contribuicoes.values()
            if isinstance(item, dict) and item.get("status") == "REALIZADO"
        )
        l.valor_previsto = total_previsto
        l.entidade_id = entidade.id
        l.observacao = json.dumps(meta)
        l.updated_by_id = current_user_id
        l.updated_at = datetime.utcnow()
        db.add(l)
    else:
        meta = {
            "grouped_card_launch": True,
            "bandeira": bandeira,
            "modalidade": modality,
            "contribuicoes": {
                venda_id: {
                    "valor": float(valor),
                    "rv": venda_rv or "N/A",
                    "vendedor": vendedor_nome or "N/A",
                    "cliente": cliente_nome or "N/A",
                    "status": "REALIZADO"
                }
            }
        }
        l = Lancamento(
            descricao=formatted_desc,
            tipo="RECEITA",
            status="EM ABERTO",
            origem="PDV",
            valor_previsto=valor,
            valor_pago=Decimal("0.00"),
            valor_juros=Decimal("0.00"),
            valor_desconto=Decimal("0.00"),
            valor_multa=Decimal("0.00"),
            data_vencimento=target_vencimento,
            data_pagamento=None,
            data_competencia=hoje_pag,
            empresa_id=empresa_id,
            plano_contas_id=plano_id,
            conta_id=None,
            entidade_id=entidade.id,
            centro_custo_id=centro_custo_id,
            observacao=json.dumps(meta),
            is_deleted=False,
            ipp=False,
            previsto=True,
            conciliado=False,
            numero_parcela=None,
            id_parcelamento=None,
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


def obter_categoria_receita_pdv(db: Session, empresa_id: int) -> int:
    empresa = db.get(Empresa, empresa_id)
    if empresa and empresa.pdv_config:
        try:
            cfg = json.loads(empresa.pdv_config)
            pc_id = cfg.get("pdv_plano_contas_receita_id")
            if pc_id: return int(pc_id)
        except: pass

    pc = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "R",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.is_deleted == False,
            (PlanoContas.nome.ilike("%venda%pdv%") | PlanoContas.nome.ilike("%receita%pdv%"))
        )
    ).first()
    if pc: return pc.id

    pc_fallback = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "R",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.is_deleted == False
        )
    ).first()
    if not pc_fallback:
        raise ValueError(f"A empresa {empresa_id} não possui nenhuma conta de receita ativa configurada no Plano de Contas.")
    return pc_fallback.id


def obter_categoria_taxas_cartao(db: Session, empresa_id: int) -> int:
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


def obter_categoria_taxas_delivery(db: Session, empresa_id: int) -> int:
    empresa = db.get(Empresa, empresa_id)
    if empresa and empresa.pdv_config:
        try:
            cfg = json.loads(empresa.pdv_config)
            pc_id = cfg.get("ifood_plano_contas_taxa_delivery_id")
            if pc_id: return int(pc_id)
        except: pass

    pc = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "D",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.is_deleted == False,
            (PlanoContas.nome.ilike("%taxa%ifood%") | PlanoContas.nome.ilike("%taxa%delivery%"))
        )
    ).first()
    if pc: return pc.id

    try:
        return obter_categoria_taxas_cartao(db, empresa_id)
    except:
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


class PdvService:
    @staticmethod
    def _resolve_generic_products(db: Session, empresa_id: int, itens: List[Any]):
        from sqlalchemy import func
        from sqlmodel import select
        from app.models.produto import Produto
        
        has_generic_id = any(item.produto_id is None or item.produto_id <= 0 for item in itens)
        
        total_prods = db.exec(
            select(func.count(Produto.id)).where(
                Produto.empresa_id == empresa_id,
                Produto.is_active == True
            )
        ).one()
        
        if has_generic_id or total_prods == 0:
            generic_prod = db.exec(
                select(Produto).where(
                    Produto.empresa_id == empresa_id,
                    Produto.nome == "Venda Geral",
                    Produto.is_active == True
                )
            ).first()
            if not generic_prod:
                generic_prod = Produto(
                    nome="Venda Geral",
                    preco_unitario=Decimal("0.00"),
                    empresa_id=empresa_id,
                    is_active=True,
                    tipo="PRODUTO"
                )
                db.add(generic_prod)
                db.commit()
                db.refresh(generic_prod)
            
            for item in itens:
                if item.produto_id is None or item.produto_id <= 0 or total_prods == 0:
                    item.produto_id = generic_prod.id

    @staticmethod
    def validar_e_processar_campos_extras(
        db: Session,
        empresa_id: int,
        campos_extras: Optional[Dict[str, Any]],
        current_user_id: int
    ) -> Dict[str, Any]:
        from app.models.usuario import Usuario
        from app.models.entidade import Entidade
        from app.models.centro_custo import CentroCusto

        if campos_extras is None:
            campos_extras = {}

        empresa = db.get(Empresa, empresa_id)
        if not empresa or not empresa.pdv_config:
            return {}

        try:
            config = json.loads(empresa.pdv_config)
        except Exception:
            return {}

        campos_config = config.get("campos_personalizados", [])
        if not campos_config:
            return {}

        resultado = {}

        for campo in campos_config:
            field_id = campo.get("id")
            if not field_id:
                continue

            # Pular se campo inativo
            if not campo.get("is_active", True):
                if field_id in campos_extras:
                    resultado[field_id] = campos_extras.get(field_id)
                continue

            label = campo.get("label", field_id)
            field_type = campo.get("type", "text")
            required = campo.get("required", False)
            depends_on = campo.get("depends_on")
            validation_regex = campo.get("validation_regex")
            options = campo.get("options", [])
            role = campo.get("role")

            # Checar visibilidade condicional
            if depends_on:
                parent_id = depends_on.get("field_id")
                equals_val = depends_on.get("equals_value")
                parent_val = campos_extras.get(parent_id)
                if str(parent_val) != str(equals_val):
                    continue

            val = campos_extras.get(field_id)

            # Validar obrigatoriedade
            if required and (val is None or str(val).strip() == ""):
                raise HTTPException(
                    status_code=400,
                    detail=f"O campo personalizado '{label}' é obrigatório."
                )

            if val is not None and str(val).strip() != "":
                val_str = str(val).strip()
                # Validar tipo
                if field_type == "checkbox":
                    if not isinstance(val, bool):
                        if val_str.lower() in ("true", "1", "yes"):
                            val = True
                        elif val_str.lower() in ("false", "0", "no"):
                            val = False
                        else:
                            raise HTTPException(
                                status_code=400,
                                detail=f"O campo personalizado '{label}' deve ser um booleano."
                            )
                elif field_type == "number":
                    try:
                        val = float(val)
                    except ValueError:
                        raise HTTPException(
                            status_code=400,
                            detail=f"O campo personalizado '{label}' deve ser um número válido."
                        )
                elif field_type == "currency":
                    try:
                        val = float(Decimal(str(val)))
                    except Exception:
                        raise HTTPException(
                            status_code=400,
                            detail=f"O campo personalizado '{label}' deve ser um valor monetário válido."
                        )
                elif field_type in ("select", "select_buttons"):
                    if options and val_str not in options:
                        raise HTTPException(
                            status_code=400,
                            detail=f"O valor '{val_str}' não é uma opção válida para o campo '{label}'."
                        )

                # Validar regex
                if validation_regex:
                    try:
                        if not re.match(validation_regex, val_str):
                            raise HTTPException(
                                status_code=400,
                                detail=f"O campo personalizado '{label}' não está no formato correto."
                            )
                    except re.error:
                        pass

                # Validar roles com tabelas do ERP
                if role == "seller":
                    try:
                        uid = int(val)
                        usr = db.get(Usuario, uid)
                        if not usr or (usr.empresa_id != empresa_id and usr.empresa_id is not None) or usr.is_deleted:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Vendedor selecionado no campo '{label}' é inválido."
                            )
                    except ValueError:
                        raise HTTPException(
                            status_code=400,
                            detail=f"ID do vendedor no campo '{label}' deve ser numérico."
                        )
                elif role == "client":
                    try:
                        cid = int(val)
                        ent = db.get(Entidade, cid)
                        if not ent or ent.empresa_id != empresa_id or ent.is_deleted:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Cliente selecionado no campo '{label}' é inválido."
                            )
                    except ValueError:
                        raise HTTPException(
                            status_code=400,
                            detail=f"ID do cliente no campo '{label}' deve ser numérico."
                        )
                elif role == "cost_center":
                    try:
                        ccid = int(val)
                        cc = db.get(CentroCusto, ccid)
                        if not cc or cc.empresa_id != empresa_id or cc.is_deleted:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Centro de custo selecionado no campo '{label}' é inválido."
                            )
                    except ValueError:
                        raise HTTPException(
                            status_code=400,
                            detail=f"ID do centro de custo no campo '{label}' deve ser numérico."
                        )

                resultado[field_id] = val

        return resultado

    @staticmethod
    def processar_estoque_venda(
        db: Session,
        empresa_id: int,
        venda_id: str,
        itens: List[Dict[str, Any]],
        status: str,
        user_id: int
    ) -> List[str]:
        from app.models.movimentacao_estoque import MovimentacaoEstoque
        from app.models.produto import Produto
        from sqlalchemy import func

        alertas = []

        # 1. Deletar (soft delete) quaisquer movimentações antigas vinculadas a esta venda
        movs_antigas = db.exec(
            select(MovimentacaoEstoque)
            .where(
                MovimentacaoEstoque.empresa_id == empresa_id,
                MovimentacaoEstoque.chave_nfe == f"pdv:{venda_id}",
                MovimentacaoEstoque.is_deleted == False
            )
        ).all()
        for m in movs_antigas:
            m.is_deleted = True
            m.deleted_at = datetime.utcnow()
            m.deleted_by_id = user_id
            db.add(m)
        db.flush()

        # 2. Se o status for REALIZADO, criar novas movimentações de saída
        if status.upper() == "REALIZADO":
            for item in itens:
                produto_id = item.get("produto_id")
                if not produto_id:
                    continue
                produto = db.get(Produto, produto_id)
                if not produto or produto.is_deleted:
                    continue
                
                # Ignorar serviços para controle de estoque
                if getattr(produto, "tipo", None) == "SERVICO":
                    continue

                quantidade = float(item.get("quantidade", 0))
                if quantidade <= 0:
                    continue

                custo_medio = getattr(produto, "preco_custo_medio", 0.0) or 0.0

                m = MovimentacaoEstoque(
                    empresa_id=empresa_id,
                    produto_id=produto_id,
                    quantidade=-quantidade,
                    tipo="Saída por Venda",
                    valor_unitario=float(custo_medio),
                    valor_total=float(Decimal(str(custo_medio)) * Decimal(str(quantidade))),
                    chave_nfe=f"pdv:{venda_id}",
                    created_by_id=user_id,
                    updated_by_id=user_id,
                    is_deleted=False,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(m)
                
                item["custo_medio_historico"] = float(custo_medio)

                # Alerta de estoque mínimo
                estoque_total = db.exec(
                    select(func.sum(MovimentacaoEstoque.quantidade))
                    .where(
                        MovimentacaoEstoque.produto_id == produto_id,
                        MovimentacaoEstoque.empresa_id == empresa_id,
                        MovimentacaoEstoque.is_deleted == False
                    )
                ).first() or 0.0

                novo_estoque = estoque_total - quantidade
                estoque_minimo = getattr(produto, "estoque_minimo", None)
                if estoque_minimo is not None and novo_estoque < float(estoque_minimo):
                    alertas.append(
                        f"Produto '{produto.nome}' ficou abaixo do estoque mínimo (Estoque atual: {novo_estoque:.2f}, Mínimo: {estoque_minimo:.2f})."
                    )

                # Alerta de preço de venda abaixo do custo
                preco_unitario_venda = item.get("preco_unitario", 0.0)
                if preco_unitario_venda < float(custo_medio):
                    alertas.append(
                        f"Produto '{produto.nome}' foi vendido abaixo do custo médio (Preço de venda: R$ {preco_unitario_venda:.2f}, Custo médio: R$ {custo_medio:.2f})."
                    )

        return alertas

    @staticmethod
    def recalcular_estoque_e_custo_medio_produto(db: Session, empresa_id: int, produto_id: int) -> None:
        from app.models.movimentacao_estoque import MovimentacaoEstoque
        from app.models.produto import Produto

        produto = db.get(Produto, produto_id)
        if not produto or produto.is_deleted:
            return

        # Busca todas as movimentações chronologically
        movs = db.exec(
            select(MovimentacaoEstoque)
            .where(
                MovimentacaoEstoque.produto_id == produto_id,
                MovimentacaoEstoque.empresa_id == empresa_id,
                MovimentacaoEstoque.is_deleted == False
            )
            .order_by(MovimentacaoEstoque.created_at, MovimentacaoEstoque.id)
        ).all()

        saldo = 0.0
        custo_medio = 0.0

        for m in movs:
            if m.quantidade > 0:
                # Entrada de estoque
                # Recalcula custo médio
                if saldo <= 0:
                    custo_medio = m.valor_unitario
                else:
                    total_valor_antigo = saldo * custo_medio
                    total_valor_novo = total_valor_antigo + m.valor_total
                    total_quantidade_nova = saldo + m.quantidade
                    if total_quantidade_nova > 0:
                        custo_medio = float(total_valor_novo / total_quantidade_nova)
                saldo += m.quantidade
            else:
                # Saída de estoque
                # Saídas não alteram o custo médio unitário, apenas o saldo
                # Mas atualizamos a movimentação de saída para gravar o custo médio correto daquele momento!
                m.valor_unitario = custo_medio
                m.valor_total = float(Decimal(str(custo_medio)) * Decimal(str(abs(m.quantidade))))
                db.add(m)
                saldo += m.quantidade

        # Salva o custo médio final no produto
        produto.preco_custo_medio = custo_medio
        db.add(produto)
        db.flush()

    @staticmethod
    def sincronizar_status_estoque_e_splits(
        db: Session,
        empresa_id: int,
        venda_id: str,
        novo_status: str,
        user_id: int
    ) -> None:
        from app.models.movimentacao_estoque import MovimentacaoEstoque
        from app.models.lancamento import Lancamento

        # 1. Obter os itens da venda via tabela operacional PdvVendaItem
        itens_db = db.exec(
            select(PdvVendaItem)
            .where(PdvVendaItem.venda_id == venda_id)
        ).all()

        if not itens_db:
            return

        itens = [
            {
                "produto_id": it.produto_id,
                "quantidade": float(it.quantidade),
                "preco_unitario": float(it.preco_unitario),
                "desconto": float(it.desconto or 0),
                "subtotal": float(it.subtotal)
            }
            for it in itens_db
        ]

        # 2. Atualizar estoque
        PdvService.processar_estoque_venda(db, empresa_id, venda_id, itens, novo_status, user_id)

        # 3. Recalcular custo médio e saldo dos produtos
        for item in itens:
            produto_id = item.get("produto_id")
            if produto_id:
                PdvService.recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

        # 4. Sincronizar o status de lançamentos de despesas extras (splits)
        desp_launches = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "PDV",
                Lancamento.id_parcelamento == venda_id,
                Lancamento.tipo == "DESPESA"
            )
        ).all()

        first_launch = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "PDV",
                Lancamento.id_parcelamento == venda_id,
                Lancamento.tipo == "RECEITA"
            )
        ).first()

        for d in desp_launches:
            if novo_status in ["CANCELADO", "DEVOLVIDO"]:
                d.status = novo_status
                d.valor_pago = Decimal("0.00")
            elif novo_status == "REALIZADO":
                receita_paga = (first_launch.status == "PAGO") if first_launch else False
                d.status = "PAGO" if receita_paga else "EM ABERTO"
                d.valor_pago = d.valor_previsto if receita_paga else Decimal("0.00")
            d.updated_by_id = user_id
            d.updated_at = datetime.utcnow()
            db.add(d)
        db.flush()

    @staticmethod
    def criar_venda(
        db: Session,
        venda_in: PdvVendaCreate,
        empresa_id: int,
        current_user_id: int
    ) -> PdvVendaItemRead:
        """
        Registra uma nova venda itemizada no PDV, criando os respectivos lançamentos financeiros.
        """
        hoje_pag = venda_in.data_pagamento or venda_in.data
        
        # 0. Validar e processar campos extras
        campos_extras_validados = PdvService.validar_e_processar_campos_extras(
            db, empresa_id, venda_in.campos_extras, current_user_id
        )

        # 0.1. Validar duplicidade por import_hash se fornecido
        if venda_in.import_hash:
            existing_hash = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == empresa_id,
                    Lancamento.import_hash == venda_in.import_hash,
                    Lancamento.is_deleted == False
                )
            ).first()
            if existing_hash:
                raise HTTPException(
                    status_code=400,
                    detail=f"Venda duplicada detectada (import_hash: {venda_in.import_hash})."
                )

        # 1. Validar se o vendedor_id pertence à mesma empresa
        vendedor = db.get(Usuario, venda_in.vendedor_id)
        if not vendedor or (vendedor.empresa_id != empresa_id and vendedor.empresa_id is not None) or vendedor.is_deleted:
            raise HTTPException(status_code=400, detail="Vendedor inválido para esta empresa.")
            
        # 1.2 Validar se o cliente (entidade_id) pertence à mesma empresa
        entidade = db.get(Entidade, venda_in.entidade_id)
        if not entidade or entidade.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Cliente inválido.")

        # 1.3 Validar se o centro de custo pertence à mesma empresa
        if not venda_in.centro_custo_id:
            empresa = db.get(Empresa, empresa_id)
            if empresa and empresa.pdv_config:
                try:
                    config = json.loads(empresa.pdv_config)
                    venda_in.centro_custo_id = config.get("pdv_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
                except Exception:
                    pass
            if not venda_in.centro_custo_id:
                cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
                venda_in.centro_custo_id = cc.id if cc else None

        centro_custo = db.get(CentroCusto, venda_in.centro_custo_id)
        if not centro_custo or centro_custo.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Centro de custo inválido.")

        # 1.4 Validar se o Registro de Venda (RV) customizado já está em uso (não deletado)
        if venda_in.rv:
            rv_stripped = venda_in.rv.strip()
            existing = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == empresa_id,
                    Lancamento.is_deleted == False,
                    col(Lancamento.observacao).like(f'%"{rv_stripped}"%')
                )
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"O Registro de Venda (RV) '{rv_stripped}' já está em uso.")

        # 3. Buscar e calcular valores dos itens do produto
        PdvService._resolve_generic_products(db, empresa_id, venda_in.itens)
        total_itens = Decimal("0.00")
        descricao_itens = []
        itens_metadados = []
        
        product_ids = [item.produto_id for item in venda_in.itens if item.produto_id is not None]
        produtos_map = {}
        if product_ids:
            produtos = db.exec(select(Produto).where(Produto.id.in_(product_ids))).all()
            produtos_map = {p.id: p for p in produtos if p.id is not None}
            
        for item in venda_in.itens:
            produto = produtos_map.get(item.produto_id)
            if not produto or produto.empresa_id != empresa_id or produto.is_deleted:
                raise HTTPException(status_code=400, detail=f"Produto ID {item.produto_id} inválido.")
            
            # Override price if provided (primarily for services, but allowed for all in legacy import)
            preco_usado = produto.preco_unitario
            if item.preco_unitario is not None:
                preco_usado = item.preco_unitario

            sa_val = preco_usado * Decimal(item.quantidade)
            total_itens += sa_val
            item_desconto = item.desconto if item.desconto is not None else Decimal("0.00")
            nome_exibicao = item.nome_customizado if item.nome_customizado else produto.nome
            descricao_itens.append(f"{nome_exibicao} x{item.quantidade}")
            itens_metadados.append({
                "produto_id": produto.id,
                "nome": nome_exibicao,
                "quantidade": item.quantidade,
                "preco_unitario": float(preco_usado),
                "desconto": float(item_desconto),
                "subtotal": float(sa_val)
            })
            
        # 4. Calcular valor final líquido
        valor_final_venda = total_itens - venda_in.desconto
        if valor_final_venda < 0:
            raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o subtotal da venda.")

        # Validar se a soma dos pagamentos corresponde ao valor final líquido
        total_pagamentos = sum(Decimal(p.valor) for p in venda_in.pagamentos)
        if abs(total_pagamentos - valor_final_venda) > Decimal("0.05"):
            raise HTTPException(
                status_code=400,
                detail=f"A soma dos pagamentos (R$ {total_pagamentos:.2f}) não condiz com o valor líquido da venda (R$ {valor_final_venda:.2f})."
            )
            
        # 5. Encontrar plano de contas padrão de receita ativo (para fallbacks)
        plano_fallback = db.exec(
            select(PlanoContas)
            .where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.tipo == "R",
                PlanoContas.eh_cabecalho == False,
                PlanoContas.is_deleted == False
            )
        ).first()
        if not plano_fallback:
            raise HTTPException(
                status_code=400,
                detail="Não há categoria de receitas ativa configurada no plano de contas da empresa."
            )
        plano_fallback_id = int(plano_fallback.id)

        # 6. Carregar configurações do PDV da empresa
        empresa = db.get(Empresa, empresa_id)
        pdv_config_dict = {}
        if empresa and empresa.pdv_config:
            try:
                pdv_config_dict = json.loads(empresa.pdv_config)
            except Exception:
                pass
        config_categorias = pdv_config_dict.get("categorias", {})
        config_marcar_como_pago = pdv_config_dict.get("marcar_como_pago", {})
        config_contas = pdv_config_dict.get("contas", {})

        # 6.2. Validar limite de crédito do cliente para vendas a faturar (EM ABERTO)
        algum_em_aberto = False
        for p in venda_in.pagamentos:
            is_paid = config_marcar_como_pago.get(
                p.tipo_pagamento,
                p.tipo_pagamento in ["dinheiro"]
            )
            regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
            if regra:
                is_paid = False
            if not is_paid:
                algum_em_aberto = True
                break

        if algum_em_aberto and entidade.observacoes and "limite_credito:" in entidade.observacoes.lower():
            try:
                match = re.search(r"limite_credito:\s*([\d\.,]+)", entidade.observacoes, re.IGNORECASE)
                if match:
                    val_str = match.group(1).strip()
                    if "," in val_str and "." in val_str:
                        if val_str.rfind(",") > val_str.rfind("."):
                            val_str = val_str.replace(".", "").replace(",", ".")
                        else:
                            val_str = val_str.replace(",", "")
                    elif "," in val_str:
                        val_str = val_str.replace(",", ".")
                    limite_credito = Decimal(val_str)
                    
                    from sqlalchemy import func
                    total_em_aberto = db.exec(
                        select(func.sum(Lancamento.valor_previsto))
                        .where(
                            Lancamento.entidade_id == entidade.id,
                            Lancamento.empresa_id == empresa_id,
                            Lancamento.status == "EM ABERTO",
                            Lancamento.is_deleted == False
                        )
                    ).first() or Decimal("0.00")
                    
                    if total_em_aberto + valor_final_venda > limite_credito:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Limite de crédito excedido para o cliente. Limite: R$ {limite_credito:.2f}, Total em aberto: R$ {total_em_aberto:.2f}, Venda atual: R$ {valor_final_venda:.2f}."
                        )
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e
        
        pdv_venda_id = str(uuid.uuid4())
        sale_status = venda_in.status.upper()

        # Criar registro operacional PdvVenda
        venda_op = PdvVenda(
            id=pdv_venda_id,
            empresa_id=empresa_id,
            entidade_id=venda_in.entidade_id,
            vendedor_id=venda_in.vendedor_id,
            centro_custo_id=venda_in.centro_custo_id,
            data_venda=venda_in.data_pagamento or hoje_pag,
            hora_venda=datetime.utcnow().strftime("%H:%M:%S"),
            valor_subtotal=total_itens,
            valor_desconto=venda_in.desconto,
            valor_total=valor_final_venda,
            status=sale_status,
            observacao=venda_in.observacao,
            rv=venda_in.rv,
            is_direct_sale=venda_in.is_direct_sale,
            import_hash=venda_in.import_hash,
            created_by_id=venda_in.vendedor_id,
            updated_by_id=current_user_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(venda_op)

        # Criar registros operacionais PdvVendaItem
        for idx, item in enumerate(venda_in.itens):
            meta_item = itens_metadados[idx]
            item_desconto = Decimal(str(meta_item["desconto"]))
            item_subtotal = Decimal(str(meta_item["subtotal"]))
            preco_unitario_res = Decimal(str(meta_item["preco_unitario"]))
            venda_item_op = PdvVendaItem(
                venda_id=pdv_venda_id,
                produto_id=item.produto_id,
                quantidade=Decimal(item.quantidade),
                preco_unitario=preco_unitario_res,
                desconto=item_desconto,
                subtotal=item_subtotal,
                nome_customizado=item.nome_customizado
            )
            db.add(venda_item_op)
        
        # Montar observação estruturada básica
        descricao_geral = ", ".join(descricao_itens)
        pagamentos_metadados = []
        for p in venda_in.pagamentos:
            pagamentos_metadados.append({
                "tipo_pagamento": p.tipo_pagamento,
                "valor": float(p.valor),
                "numero_parcelas": p.numero_parcelas,
                "valor_parcela": float(p.valor_parcela) if p.valor_parcela else None,
                "data_pagamento": str(p.data_pagamento) if p.data_pagamento else None
            })

        dados_observacao_base = {
            "pdv_venda": True,
            "pdv_venda_id": pdv_venda_id,
            "is_direct_sale": venda_in.is_direct_sale,
            "cliente": entidade.nome,
            "entidade_id": venda_in.entidade_id,
            "centro_custo_id": venda_in.centro_custo_id,
            "observacao_texto": venda_in.observacao,
            "subtotal": float(total_itens),
            "desconto": float(venda_in.desconto),
            "status": sale_status,
            "itens": itens_metadados,
            "pagamentos": pagamentos_metadados,
            "comprovante_url": None,
            "comprovante_urls": [],
            "campos_extras": campos_extras_validados
        }
        
        launches_created = []
        desconto_ja_atribuido = False

        # 7. Criar os lançamentos financeiros correspondentes a cada pagamento
        for p in venda_in.pagamentos:
            plano_id = obter_categoria_pagamento(db, empresa_id, p.tipo_pagamento, config_categorias, plano_fallback_id)
            conta_id_str = config_contas.get(p.tipo_pagamento)
            conta_id = int(conta_id_str) if conta_id_str else None

            hoje_pag = p.data_pagamento if p.data_pagamento else (venda_in.data_pagamento if venda_in.data_pagamento else venda_in.data)

            if sale_status == "ORCAMENTO":
                is_paid = False
            else:
                is_paid = config_marcar_como_pago.get(
                    p.tipo_pagamento,
                    p.tipo_pagamento in ["dinheiro"]
                )

            # Buscar regra de cartão se houver
            regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
            if regra:
                is_paid = False
                if regra.conta_destino_id:
                    conta_id = regra.conta_destino_id

            # Validar se a conta existe para evitar erro de chave estrangeira
            if conta_id:
                conta_valida = db.exec(
                    select(Conta)
                    .where(Conta.id == conta_id, Conta.empresa_id == empresa_id)
                ).first()
                if not conta_valida:
                    conta_id = None

            # Validar se a categoria existe para evitar erro de chave estrangeira
            plano_valido = db.exec(
                select(PlanoContas)
                .where(PlanoContas.id == plano_id, PlanoContas.empresa_id == empresa_id, PlanoContas.is_deleted == False)
            ).first()
            if not plano_valido:
                plano_id = plano_fallback_id

            if is_paid and not conta_id:
                conta_id = obter_conta_caixa_fisica(db, empresa_id)

            tp_lower = (p.tipo_pagamento or "").lower()
            is_card = bool(regra) or any(k in tp_lower for k in ["cartao", "credito", "debito", "debit", "credit"])

            if is_card:
                bandeira_nome = (regra.bandeira if regra else p.bandeira) or "OUTROS"
                
                # Verificar se é pagamento parcelado
                is_parcelada = False
                formas_config = pdv_config_dict.get("formas_pagamento", [])
                matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
                if matched_forma:
                    is_parcelada = matched_forma.get("parcelada", False)
                else:
                    is_parcelada = p.tipo_pagamento in ["cartao_credito_parcelado", "credito_parcelado"]

                num_parc = int(p.numero_parcelas) if (is_parcelada and p.numero_parcelas and p.numero_parcelas > 1) else 1
                total_pag = Decimal(str(p.valor))
                base_val = (total_pag / num_parc).quantize(Decimal("0.01"))
                last_val = total_pag - (base_val * (num_parc - 1))

                vendedor_obj = db.get(Usuario, venda_in.vendedor_id) if venda_in.vendedor_id else None
                vendedor_nome = (vendedor_obj.nome or vendedor_obj.email) if vendedor_obj else "Sem vendedor"
                cliente_nome = (entidade.nome or entidade.nome_fantasia) if entidade else "Consumidor Final"

                for i in range(1, num_parc + 1):
                    if regra:
                        if regra.modo_parcelamento == "ANTECIPADO":
                            vencimento = calcular_payout_date(hoje_pag, regra)
                            fee_percentage = regra.taxa_porcentagem + (i - 1) * regra.taxa_antecipacao
                        else:
                            base_installment_date = shift_months(hoje_pag, i - 1)
                            vencimento = calcular_payout_date(base_installment_date, regra)
                            fee_percentage = regra.taxa_porcentagem
                    else:
                        if is_parcelada:
                            year = hoje_pag.year + (hoje_pag.month - 1 + i) // 12
                            month = (hoje_pag.month - 1 + i) % 12 + 1
                            day = min(hoje_pag.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
                            vencimento = date(year, month, day)
                        else:
                            prazo = 1 if "debito" in p.tipo_pagamento.lower() else 30
                            vencimento = hoje_pag + timedelta(days=prazo)
                        fee_percentage = Decimal("0.00")

                    valor_linha = base_val if i < num_parc else last_val
                    hash_unico = f"{venda_in.import_hash}-P{i}" if (venda_in.import_hash and num_parc > 1) else (venda_in.import_hash if venda_in.import_hash else None)

                    # Mapear forma de pagamento para caixa alta padrão
                    forma_pag_mapeada = p.tipo_pagamento.upper()
                    if "CREDITO_VISTA" in forma_pag_mapeada or "CREDITO_AVISTA" in forma_pag_mapeada or "CREDITO_AT_VISTA" in forma_pag_mapeada or forma_pag_mapeada in ["CARTAO_CREDITO_VISTA", "CREDITO"]:
                        forma_pag_mapeada = "CREDITO_AVISTA"
                    elif "CREDITO_PARCELADO" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_CREDITO_PARCELADO":
                        forma_pag_mapeada = "CREDITO_PARCELADO"
                    elif "DEBITO" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_DEBITO":
                        forma_pag_mapeada = "DEBITO"

                    mov = PdvMovimentacao(
                        empresa_id=empresa_id,
                        tipo="ENTRADA",
                        descricao=f"Parcela {i}/{num_parc} Venda PDV {pdv_venda_id}" if num_parc > 1 else f"Venda PDV {pdv_venda_id}",
                        valor=valor_linha,
                        forma_pagamento=forma_pag_mapeada,
                        bandeira=bandeira_nome.upper(),
                        parcelas=num_parc,
                        numero_parcela=i,
                        data=hoje_pag,
                        centro_custo_id=venda_in.centro_custo_id,
                        conta_id=conta_id,
                        conciliado=False,
                        venda_id=pdv_venda_id,
                        import_hash=hash_unico,
                        created_by_id=venda_in.vendedor_id,
                        updated_by_id=current_user_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(mov)

                    # Criar/atualizar o lançamento financeiro agrupado no Financeiro
                    formatted_desc = format_card_description(bandeira_nome, p.tipo_pagamento)
                    modality = "Debito" if ("debito" in tp_lower or "debit" in tp_lower) else "Credito"
                    adicionar_ou_atualizar_recebivel_cartao_agrupado(
                        db=db,
                        empresa_id=empresa_id,
                        venda_id=pdv_venda_id,
                        vencimento=vencimento,
                        valor=valor_linha,
                        formatted_desc=formatted_desc,
                        plano_id=plano_id,
                        conta_id=None,
                        centro_custo_id=venda_in.centro_custo_id,
                        hoje_pag=hoje_pag,
                        bandeira=bandeira_nome.upper(),
                        modality=modality,
                        current_user_id=current_user_id,
                        venda_rv=venda_in.rv,
                        vendedor_nome=vendedor_nome,
                        cliente_nome=cliente_nome
                    )

                desconto_ja_atribuido = True
            else:
                if p.tipo_pagamento.lower() == "dinheiro":
                    plano_id = obter_categoria_receita_pdv(db, empresa_id)

                is_parcelada = False
                formas_config = pdv_config_dict.get("formas_pagamento", [])
                matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
                if matched_forma:
                    is_parcelada = matched_forma.get("parcelada", False)
                else:
                    is_parcelada = p.tipo_pagamento in ["boleto"]

                num_parc = int(p.numero_parcelas) if (is_parcelada and p.numero_parcelas and p.numero_parcelas > 1) else 1
                total_pag = Decimal(str(p.valor))
                base_val = (total_pag / num_parc).quantize(Decimal("0.01"))
                last_val = total_pag - (base_val * (num_parc - 1))

                for i in range(1, num_parc + 1):
                    vencimento = shift_months(hoje_pag, i - 1)
                    valor_linha = base_val if i < num_parc else last_val

                    obs_data = dados_observacao_base.copy()
                    obs_data["tipo_pagamento"] = p.tipo_pagamento
                    obs_data["numero_parcela"] = i
                    obs_data["total_parcelas"] = num_parc

                    l = Lancamento(
                        descricao=f"Venda Parcela {i}/{num_parc} RV-AUTOGERADO - {descricao_geral[:150]}" if num_parc > 1 else f"Venda RV-AUTOGERADO - {descricao_geral[:200]}",
                        tipo="RECEITA",
                        status="PAGO" if is_paid else "EM ABERTO",
                        origem="PDV_CAIXA" if p.tipo_pagamento.lower() == "dinheiro" else "PDV",
                        valor_previsto=valor_linha,
                        valor_pago=valor_linha if is_paid else Decimal("0.00"),
                        valor_juros=Decimal("0.00"),
                        valor_desconto=Decimal("0.00") if desconto_ja_atribuido else venda_in.desconto,
                        valor_multa=Decimal("0.00"),
                        data_vencimento=vencimento,
                        data_pagamento=vencimento if is_paid else None,
                        data_competencia=hoje_pag,
                        competencia=hoje_pag.strftime("%m-%Y"),
                        empresa_id=empresa_id,
                        plano_contas_id=plano_id,
                        conta_id=conta_id,
                        entidade_id=venda_in.entidade_id,
                        centro_custo_id=venda_in.centro_custo_id,
                        created_by_id=venda_in.vendedor_id,
                        updated_by_id=current_user_id,
                        observacao=json.dumps(obs_data),
                        is_deleted=False,
                        ipp=False,
                        previsto=True,
                        conciliado=False,
                        id_parcelamento=pdv_venda_id,
                        numero_parcela=i if num_parc > 1 else None,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(l)
                    launches_created.append(l)

                    # Mapear forma de pagamento para caixa alta padrão
                    forma_pag_mapeada = p.tipo_pagamento.upper()
                    if "PIX" in forma_pag_mapeada:
                        forma_pag_mapeada = "PIX"
                    elif "DINHEIRO" in forma_pag_mapeada:
                        forma_pag_mapeada = "DINHEIRO"
                    elif "BOLETO" in forma_pag_mapeada:
                        forma_pag_mapeada = "BOLETO"

                    hash_unico = f"{venda_in.import_hash}-P{i}" if (venda_in.import_hash and num_parc > 1) else (venda_in.import_hash if venda_in.import_hash else None)

                    mov = PdvMovimentacao(
                        empresa_id=empresa_id,
                        tipo="ENTRADA",
                        descricao=f"Parcela {i}/{num_parc} Venda PDV {pdv_venda_id}" if num_parc > 1 else f"Venda PDV {pdv_venda_id}",
                        valor=valor_linha,
                        forma_pagamento=forma_pag_mapeada,
                        bandeira=(p.bandeira or "OUTROS").upper(),
                        parcelas=num_parc,
                        numero_parcela=i,
                        data=hoje_pag,
                        centro_custo_id=venda_in.centro_custo_id,
                        conta_id=conta_id,
                        conciliado=False,
                        venda_id=pdv_venda_id,
                        import_hash=hash_unico,
                        created_by_id=venda_in.vendedor_id,
                        updated_by_id=current_user_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(mov)

                desconto_ja_atribuido = True

        # 7.2. Criar lançamentos de despesas extras associadas (splits)
        campos_config = pdv_config_dict.get("campos_personalizados", [])
        extra_despesas = []
        for campo in campos_config:
            field_id = campo.get("id")
            plano_id_desp = campo.get("planoContasId")
            if plano_id_desp and campo.get("type") == "currency":
                val = campos_extras_validados.get(field_id)
                if val and float(val) > 0:
                    extra_despesas.append({
                        "field_id": field_id,
                        "label": campo.get("label", field_id),
                        "valor": Decimal(str(val)),
                        "plano_contas_id": int(plano_id_desp)
                    })

        for ed in extra_despesas:
            desp_status = "PAGO" if (launches_created and launches_created[0].status == "PAGO") else "EM ABERTO"
            desp_valor_pago = ed["valor"] if desp_status == "PAGO" else Decimal("0.00")
            
            obs_data_desp = dados_observacao_base.copy()
            obs_data_desp["pdv_despesa_extra"] = True
            obs_data_desp["parent_pdv_venda_id"] = pdv_venda_id
            obs_data_desp["campos_extras"] = campos_extras_validados
            
            conta_id_desp = launches_created[0].conta_id if launches_created else None
            
            l_desp = Lancamento(
                descricao=f"Despesa Extra ({ed['label']}) RV-AUTOGERADO - {descricao_geral[:150]}",
                tipo="DESPESA",
                status=desp_status,
                origem="PDV",
                valor_previsto=ed["valor"],
                valor_pago=desp_valor_pago,
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00"),
                valor_multa=Decimal("0.00"),
                data_vencimento=launches_created[0].data_vencimento if launches_created else hoje_pag,
                data_pagamento=launches_created[0].data_pagamento if (launches_created and desp_status == "PAGO") else None,
                data_competencia=launches_created[0].data_competencia if launches_created else hoje_pag,
                empresa_id=empresa_id,
                plano_contas_id=ed["plano_contas_id"],
                conta_id=conta_id_desp,
                entidade_id=venda_in.entidade_id,
                centro_custo_id=venda_in.centro_custo_id,
                created_by_id=venda_in.vendedor_id,
                updated_by_id=current_user_id,
                observacao=json.dumps(obs_data_desp),
                is_deleted=False,
                ipp=False,
                previsto=True,
                conciliado=False,
                id_parcelamento=pdv_venda_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(l_desp)
            launches_created.append(l_desp)

        db.flush()
        
        if launches_created:
            first_launch = launches_created[0]
            rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{first_launch.id:06d}"
        else:
            import random
            rand_id = random.randint(100000, 999999)
            rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{rand_id:06d}"
        
        for l in launches_created:
            l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
            meta = json.loads(l.observacao)
            meta["rv"] = rv_code
            l.observacao = json.dumps(meta)
            if venda_in.import_hash:
                l.import_hash = venda_in.import_hash
            db.add(l)
            
        # 8. Processar movimentações de estoque
        alertas = PdvService.processar_estoque_venda(
            db, empresa_id, pdv_venda_id, itens_metadados, sale_status, current_user_id
        )

        # Recalcular custo médio e saldo para cada produto vendido
        for item in itens_metadados:
            produto_id = item.get("produto_id")
            if produto_id:
                PdvService.recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

        for l in launches_created:
            meta = json.loads(l.observacao)
            meta["itens"] = itens_metadados
            l.observacao = json.dumps(meta)
            db.add(l)

        db.flush()
        if launches_created:
            db.refresh(first_launch)
            data_registro = first_launch.data_pagamento or first_launch.data_vencimento or hoje_pag
            launch_id = int(first_launch.id or 0)
            launch_desc = first_launch.descricao
        else:
            data_registro = hoje_pag
            launch_id = 0
            launch_desc = f"Venda {rv_code} - {descricao_geral[:200]}"

        return PdvVendaItemRead(
            id=launch_id,
            rv=rv_code,
            data=data_registro,
            hora=datetime.utcnow().strftime("%H:%M"),
            vendedor=(vendedor.nome or vendedor.email),
            status=sale_status,
            descricao=launch_desc,
            valor=valor_final_venda,
            venda_id_uuid=pdv_venda_id,
            comprovante_url=None,
            comprovante_urls=[],
            campos_extras=campos_extras_validados,
            alertas=alertas,
            is_direct_sale=venda_in.is_direct_sale
        )

    @staticmethod
    def atualizar_venda(
        db: Session,
        venda_id: str,
        venda_in: PdvVendaCreate,
        empresa_id: int,
        current_user_id: int
    ) -> PdvVendaItemRead:
        """
        Atualiza uma venda existente substituindo seus lançamentos pelos novos informados.
        """
        # Query active launches of the sale BEFORE deleting/updating them
        launches_antigos = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.id_parcelamento == venda_id
            )
        ).all()

        # 1. Validar travas de segurança e remover contribuições/lançamentos antigos
        remover_contribuicoes_venda(db, empresa_id, venda_id, current_user_id)

        hoje_pag = venda_in.data_pagamento or venda_in.data
        
        # 0. Validar e processar campos extras
        campos_extras_validados = PdvService.validar_e_processar_campos_extras(
            db, empresa_id, venda_in.campos_extras, current_user_id
        )

        # 0.1. Validar duplicidade por import_hash se fornecido
        if venda_in.import_hash:
            existing_hash = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == empresa_id,
                    Lancamento.import_hash == venda_in.import_hash,
                    Lancamento.is_deleted == False,
                    Lancamento.id_parcelamento != venda_id
                )
            ).first()
            if existing_hash:
                raise HTTPException(
                    status_code=400,
                    detail=f"Venda duplicada detectada (import_hash: {venda_in.import_hash})."
                )

        # 2. Validar vendedor, cliente e centro de custo
        vendedor = db.get(Usuario, venda_in.vendedor_id)
        if not vendedor or (vendedor.empresa_id != empresa_id and vendedor.empresa_id is not None) or vendedor.is_deleted:
            raise HTTPException(status_code=400, detail="Vendedor inválido para esta empresa.")
            
        entidade = db.get(Entidade, venda_in.entidade_id)
        if not entidade or entidade.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Cliente inválido.")

        if not venda_in.centro_custo_id:
            empresa = db.get(Empresa, empresa_id)
            if empresa and empresa.pdv_config:
                try:
                    config = json.loads(empresa.pdv_config)
                    venda_in.centro_custo_id = config.get("pdv_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
                except Exception:
                    pass
            if not venda_in.centro_custo_id:
                cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
                venda_in.centro_custo_id = cc.id if cc else None

        centro_custo = db.get(CentroCusto, venda_in.centro_custo_id)
        if not centro_custo or centro_custo.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Centro de custo inválido.")

        # 3. Se um novo RV customizado for enviado e for diferente do atual, validar se já está em uso
        rv_antigo = None
        for l in launches_antigos:
            if l.observacao:
                try:
                    meta_l = json.loads(l.observacao)
                    rv_antigo = meta_l.get("rv")
                    break
                except Exception:
                    pass
        
        if venda_in.rv and venda_in.rv.strip() != rv_antigo:
            rv_stripped = venda_in.rv.strip()
            existing = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == empresa_id,
                    Lancamento.is_deleted == False,
                    Lancamento.id_parcelamento != venda_id,
                    col(Lancamento.observacao).like(f'%"{rv_stripped}"%')
                )
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"O Registro de Venda (RV) '{rv_stripped}' já está em uso.")

        # 4. Calcular novos valores
        PdvService._resolve_generic_products(db, empresa_id, venda_in.itens)
        total_itens = Decimal("0.00")
        descricao_itens = []
        itens_metadados = []
        
        product_ids = [item.produto_id for item in venda_in.itens if item.produto_id is not None]
        produtos_map = {}
        if product_ids:
            produtos = db.exec(select(Produto).where(Produto.id.in_(product_ids))).all()
            produtos_map = {p.id: p for p in produtos if p.id is not None}
            
        for item in venda_in.itens:
            produto = produtos_map.get(item.produto_id)
            if not produto or produto.empresa_id != empresa_id or produto.is_deleted:
                raise HTTPException(status_code=400, detail=f"Produto ID {item.produto_id} inválido.")
            
            preco_usado = produto.preco_unitario
            if item.preco_unitario is not None:
                preco_usado = item.preco_unitario

            sa_val = preco_usado * Decimal(item.quantidade)
            total_itens += sa_val
            item_desconto = item.desconto if item.desconto is not None else Decimal("0.00")
            nome_exibicao = item.nome_customizado if item.nome_customizado else produto.nome
            descricao_itens.append(f"{nome_exibicao} x{item.quantidade}")
            itens_metadados.append({
                "produto_id": produto.id,
                "nome": nome_exibicao,
                "quantidade": item.quantidade,
                "preco_unitario": float(preco_usado),
                "desconto": float(item_desconto),
                "subtotal": float(sa_val)
            })
            
        valor_final_venda = total_itens - venda_in.desconto
        if valor_final_venda < 0:
            raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o subtotal da venda.")

        total_pagamentos = sum(Decimal(p.valor) for p in venda_in.pagamentos)
        if abs(total_pagamentos - valor_final_venda) > Decimal("0.05"):
            raise HTTPException(
                status_code=400,
                detail=f"A soma dos pagamentos (R$ {total_pagamentos:.2f}) não condiz com o valor líquido da venda (R$ {valor_final_venda:.2f})."
            )
            
        plano_fallback = db.exec(
            select(PlanoContas)
            .where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.tipo == "R",
                PlanoContas.eh_cabecalho == False,
                PlanoContas.is_deleted == False
            )
        ).first()
        if not plano_fallback:
            raise HTTPException(status_code=400, detail="Não há categoria de receitas ativa configurada no plano de contas da empresa.")
        plano_fallback_id = int(plano_fallback.id)

        # 5. Carregar configurações do PDV da empresa
        empresa = db.get(Empresa, empresa_id)
        pdv_config_dict = {}
        if empresa and empresa.pdv_config:
            try:
                pdv_config_dict = json.loads(empresa.pdv_config)
            except Exception:
                pass
        config_categorias = pdv_config_dict.get("categorias", {})
        config_marcar_como_pago = pdv_config_dict.get("marcar_como_pago", {})
        config_contas = pdv_config_dict.get("contas", {})

        # 6.2. Validar limite de crédito do cliente para vendas a faturar (EM ABERTO)
        algum_em_aberto = False
        for p in venda_in.pagamentos:
            is_paid = config_marcar_como_pago.get(
                p.tipo_pagamento,
                p.tipo_pagamento in ["dinheiro"]
            )
            regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
            if regra:
                is_paid = False
            if not is_paid:
                algum_em_aberto = True
                break

        if algum_em_aberto and entidade.observacoes and "limite_credito:" in entidade.observacoes.lower():
            try:
                match = re.search(r"limite_credito:\s*([\d\.,]+)", entidade.observacoes, re.IGNORECASE)
                if match:
                    val_str = match.group(1).strip()
                    if "," in val_str and "." in val_str:
                        if val_str.rfind(",") > val_str.rfind("."):
                            val_str = val_str.replace(".", "").replace(",", ".")
                        else:
                            val_str = val_str.replace(",", "")
                    elif "," in val_str:
                        val_str = val_str.replace(",", ".")
                    limite_credito = Decimal(val_str)
                    
                    from sqlalchemy import func
                    total_em_aberto = db.exec(
                        select(func.sum(Lancamento.valor_previsto))
                        .where(
                            Lancamento.entidade_id == entidade.id,
                            Lancamento.empresa_id == empresa_id,
                            Lancamento.status == "EM ABERTO",
                            Lancamento.is_deleted == False,
                            Lancamento.id_parcelamento != venda_id
                        )
                    ).first() or Decimal("0.00")
                    
                    if total_em_aberto + valor_final_venda > limite_credito:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Limite de crédito excedido para o cliente. Limite: R$ {limite_credito:.2f}, Total em aberto: R$ {total_em_aberto:.2f}, Venda atual: R$ {valor_final_venda:.2f}."
                        )
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e

        # 6. Carregar anexos antigos para reassociá-los aos novos lançamentos
        old_launch_ids = [l.id for l in launches_antigos if l.id is not None]
        old_anexos = []
        if old_launch_ids:
            old_anexos = db.exec(
                select(AnexoLancamento)
                .where(
                    AnexoLancamento.lancamento_id.in_(old_launch_ids),
                    AnexoLancamento.empresa_id == empresa_id,
                    AnexoLancamento.is_deleted == False
                )
            ).all()

        old_comprovante_url = None
        old_comprovante_urls = []
        for l in launches_antigos:
            if l.observacao:
                try:
                    meta_l = json.loads(l.observacao)
                    if meta_l.get("comprovante_url"):
                        old_comprovante_url = meta_l.get("comprovante_url")
                    if meta_l.get("comprovante_urls"):
                        old_comprovante_urls = meta_l.get("comprovante_urls")
                except Exception:
                    pass

        if old_comprovante_url and old_comprovante_url not in old_comprovante_urls:
            old_comprovante_urls.insert(0, old_comprovante_url)

        if venda_in.comprovante_urls is not None:
            old_comprovante_urls = [url for url in old_comprovante_urls if url in venda_in.comprovante_urls]
            old_comprovante_url = old_comprovante_urls[0] if old_comprovante_urls else None

        # Marcar lançamentos antigos como deletados (exclusão lógica)
        for l in launches_antigos:
            l.is_deleted = True
            l.deleted_at = datetime.utcnow()
            l.deleted_by_id = current_user_id
            db.add(l)

        # 7. Criar os novos lançamentos com o mesmo venda_id (id_parcelamento)
        sale_status = venda_in.status.upper()

        # Atualizar registro operacional PdvVenda
        venda_op = db.get(PdvVenda, venda_id)
        if venda_op:
            venda_op.entidade_id = venda_in.entidade_id
            venda_op.vendedor_id = venda_in.vendedor_id
            venda_op.centro_custo_id = venda_in.centro_custo_id
            venda_op.data_venda = venda_in.data_pagamento or hoje_pag
            venda_op.valor_subtotal = total_itens
            venda_op.valor_desconto = venda_in.desconto
            venda_op.valor_total = valor_final_venda
            venda_op.status = sale_status
            venda_op.observacao = venda_in.observacao
            venda_op.rv = venda_in.rv
            venda_op.is_direct_sale = venda_in.is_direct_sale
            venda_op.import_hash = venda_in.import_hash
            venda_op.updated_by_id = current_user_id
            venda_op.updated_at = datetime.utcnow()
            db.add(venda_op)

        # Deletar itens antigos e criar novos
        db.exec(
            delete(PdvVendaItem).where(PdvVendaItem.venda_id == venda_id)
        )
        for idx, item in enumerate(venda_in.itens):
            meta_item = itens_metadados[idx]
            item_desconto = Decimal(str(meta_item["desconto"]))
            item_subtotal = Decimal(str(meta_item["subtotal"]))
            preco_unitario_res = Decimal(str(meta_item["preco_unitario"]))
            venda_item_op = PdvVendaItem(
                venda_id=venda_id,
                produto_id=item.produto_id,
                quantidade=Decimal(item.quantidade),
                preco_unitario=preco_unitario_res,
                desconto=item_desconto,
                subtotal=item_subtotal,
                nome_customizado=item.nome_customizado
            )
            db.add(venda_item_op)
        
        descricao_geral = ", ".join(descricao_itens)
        pagamentos_metadados = []
        for p in venda_in.pagamentos:
            pagamentos_metadados.append({
                "tipo_pagamento": p.tipo_pagamento,
                "valor": float(p.valor),
                "numero_parcelas": p.numero_parcelas,
                "valor_parcela": float(p.valor_parcela) if p.valor_parcela else None,
                "data_pagamento": str(p.data_pagamento) if p.data_pagamento else None
            })

        dados_observacao_base = {
            "pdv_venda": True,
            "pdv_venda_id": venda_id,
            "is_direct_sale": venda_in.is_direct_sale,
            "cliente": entidade.nome,
            "entidade_id": venda_in.entidade_id,
            "centro_custo_id": venda_in.centro_custo_id,
            "observacao_texto": venda_in.observacao,
            "subtotal": float(total_itens),
            "desconto": float(venda_in.desconto),
            "status": sale_status,
            "itens": itens_metadados,
            "pagamentos": pagamentos_metadados,
            "comprovante_url": old_comprovante_url,
            "comprovante_urls": old_comprovante_urls,
            "campos_extras": campos_extras_validados
        }
        
        launches_created = []
        desconto_ja_atribuido = False
        pdv_venda_id = venda_id

        for p in venda_in.pagamentos:
            plano_id = obter_categoria_pagamento(db, empresa_id, p.tipo_pagamento, config_categorias, plano_fallback_id)
            conta_id_str = config_contas.get(p.tipo_pagamento)
            conta_id = int(conta_id_str) if conta_id_str else None

            hoje_pag = p.data_pagamento if p.data_pagamento else (venda_in.data_pagamento if venda_in.data_pagamento else venda_in.data)

            if sale_status == "ORCAMENTO":
                is_paid = False
            else:
                is_paid = config_marcar_como_pago.get(
                    p.tipo_pagamento,
                    p.tipo_pagamento in ["dinheiro"]
                )

            # Buscar regra de cartão se houver
            regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
            if regra:
                is_paid = False
                if regra.conta_destino_id:
                    conta_id = regra.conta_destino_id

            # Validar se a conta existe para evitar erro de chave estrangeira
            if conta_id:
                conta_valida = db.exec(
                    select(Conta)
                    .where(Conta.id == conta_id, Conta.empresa_id == empresa_id)
                ).first()
                if not conta_valida:
                    conta_id = None

            # Validar se a categoria existe para evitar erro de chave estrangeira
            plano_valido = db.exec(
                select(PlanoContas)
                .where(PlanoContas.id == plano_id, PlanoContas.empresa_id == empresa_id, PlanoContas.is_deleted == False)
            ).first()
            if not plano_valido:
                plano_id = plano_fallback_id

            if is_paid and not conta_id:
                conta_id = obter_conta_caixa_fisica(db, empresa_id)

            is_card = bool(regra) or ("cartao" in (p.tipo_pagamento or "").lower())

            if is_card:
                bandeira_nome = (regra.bandeira if regra else p.bandeira) or "OUTROS"
                
                # Verificar se é pagamento parcelado
                is_parcelada = False
                formas_config = pdv_config_dict.get("formas_pagamento", [])
                matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
                if matched_forma:
                    is_parcelada = matched_forma.get("parcelada", False)
                else:
                    is_parcelada = p.tipo_pagamento in ["cartao_credito_parcelado"]

                num_parc = int(p.numero_parcelas) if (is_parcelada and p.numero_parcelas and p.numero_parcelas > 1) else 1
                total_pag = Decimal(str(p.valor))
                base_val = (total_pag / num_parc).quantize(Decimal("0.01"))
                last_val = total_pag - (base_val * (num_parc - 1))

                for i in range(1, num_parc + 1):
                    if regra:
                        if regra.modo_parcelamento == "ANTECIPADO":
                            vencimento = calcular_payout_date(hoje_pag, regra)
                            fee_percentage = regra.taxa_porcentagem + (i - 1) * regra.taxa_antecipacao
                        else:
                            base_installment_date = shift_months(hoje_pag, i - 1)
                            vencimento = calcular_payout_date(base_installment_date, regra)
                            fee_percentage = regra.taxa_porcentagem
                    else:
                        if is_parcelada:
                            year = hoje_pag.year + (hoje_pag.month - 1 + i) // 12
                            month = (hoje_pag.month - 1 + i) % 12 + 1
                            day = min(hoje_pag.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
                            vencimento = date(year, month, day)
                        else:
                            prazo = 1 if "debito" in p.tipo_pagamento.lower() else 30
                            vencimento = hoje_pag + timedelta(days=prazo)
                        fee_percentage = Decimal("0.00")

                    valor_linha = base_val if i < num_parc else last_val
                    hash_unico = f"{venda_in.import_hash}-P{i}" if (venda_in.import_hash and num_parc > 1) else (venda_in.import_hash if venda_in.import_hash else None)

                    # Mapear forma de pagamento para caixa alta padrão
                    forma_pag_mapeada = p.tipo_pagamento.upper()
                    if "CREDITO_VISTA" in forma_pag_mapeada or "CREDITO_AVISTA" in forma_pag_mapeada or "CREDITO_AT_VISTA" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_CREDITO_VISTA":
                        forma_pag_mapeada = "CREDITO_AVISTA"
                    elif "CREDITO_PARCELADO" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_CREDITO_PARCELADO":
                        forma_pag_mapeada = "CREDITO_PARCELADO"
                    elif "DEBITO" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_DEBITO":
                        forma_pag_mapeada = "DEBITO"

                    mov = PdvMovimentacao(
                        empresa_id=empresa_id,
                        tipo="ENTRADA",
                        descricao=f"Parcela {i}/{num_parc} Venda PDV {pdv_venda_id}" if num_parc > 1 else f"Venda PDV {pdv_venda_id}",
                        valor=valor_linha,
                        forma_pagamento=forma_pag_mapeada,
                        bandeira=bandeira_nome.upper(),
                        parcelas=num_parc,
                        numero_parcela=i,
                        data=hoje_pag,
                        centro_custo_id=venda_in.centro_custo_id,
                        conta_id=conta_id,
                        conciliado=False,
                        venda_id=pdv_venda_id,
                        import_hash=hash_unico,
                        created_by_id=venda_in.vendedor_id,
                        updated_by_id=current_user_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(mov)

                desconto_ja_atribuido = True
            else:
                if p.tipo_pagamento.lower() == "dinheiro":
                    plano_id = obter_categoria_receita_pdv(db, empresa_id)

                is_parcelada = False
                formas_config = pdv_config_dict.get("formas_pagamento", [])
                matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
                if matched_forma:
                    is_parcelada = matched_forma.get("parcelada", False)
                else:
                    is_parcelada = p.tipo_pagamento in ["boleto"]

                num_parc = int(p.numero_parcelas) if (is_parcelada and p.numero_parcelas and p.numero_parcelas > 1) else 1
                total_pag = Decimal(str(p.valor))
                base_val = (total_pag / num_parc).quantize(Decimal("0.01"))
                last_val = total_pag - (base_val * (num_parc - 1))

                for i in range(1, num_parc + 1):
                    vencimento = shift_months(hoje_pag, i - 1)
                    valor_linha = base_val if i < num_parc else last_val

                    obs_data = dados_observacao_base.copy()
                    obs_data["tipo_pagamento"] = p.tipo_pagamento
                    obs_data["numero_parcela"] = i
                    obs_data["total_parcelas"] = num_parc

                    l = Lancamento(
                        descricao=f"Venda Parcela {i}/{num_parc} RV-AUTOGERADO - {descricao_geral[:150]}" if num_parc > 1 else f"Venda RV-AUTOGERADO - {descricao_geral[:200]}",
                        tipo="RECEITA",
                        status="PAGO" if is_paid else "EM ABERTO",
                        origem="PDV_CAIXA" if p.tipo_pagamento.lower() == "dinheiro" else "PDV",
                        valor_previsto=valor_linha,
                        valor_pago=valor_linha if is_paid else Decimal("0.00"),
                        valor_juros=Decimal("0.00"),
                        valor_desconto=Decimal("0.00") if desconto_ja_atribuido else venda_in.desconto,
                        valor_multa=Decimal("0.00"),
                        data_vencimento=vencimento,
                        data_pagamento=vencimento if is_paid else None,
                        data_competencia=hoje_pag,
                        competencia=hoje_pag.strftime("%m-%Y"),
                        empresa_id=empresa_id,
                        plano_contas_id=plano_id,
                        conta_id=conta_id,
                        entidade_id=venda_in.entidade_id,
                        centro_custo_id=venda_in.centro_custo_id,
                        created_by_id=venda_in.vendedor_id,
                        updated_by_id=current_user_id,
                        observacao=json.dumps(obs_data),
                        is_deleted=False,
                        ipp=False,
                        previsto=True,
                        conciliado=False,
                        id_parcelamento=pdv_venda_id,
                        numero_parcela=i if num_parc > 1 else None,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(l)
                    launches_created.append(l)

                desconto_ja_atribuido = True

        campos_config = pdv_config_dict.get("campos_personalizados", [])
        extra_despesas = []
        for campo in campos_config:
            field_id = campo.get("id")
            plano_id_desp = campo.get("planoContasId")
            if plano_id_desp and campo.get("type") == "currency":
                val = campos_extras_validados.get(field_id)
                if val and float(val) > 0:
                    extra_despesas.append({
                        "field_id": field_id,
                        "label": campo.get("label", field_id),
                        "valor": Decimal(str(val)),
                        "plano_contas_id": int(plano_id_desp)
                    })

        for ed in extra_despesas:
            desp_status = "PAGO" if (launches_created and launches_created[0].status == "PAGO") else "EM ABERTO"
            desp_valor_pago = ed["valor"] if desp_status == "PAGO" else Decimal("0.00")
            
            obs_data_desp = dados_observacao_base.copy()
            obs_data_desp["pdv_despesa_extra"] = True
            obs_data_desp["parent_pdv_venda_id"] = venda_id
            obs_data_desp["campos_extras"] = campos_extras_validados
            
            conta_id_desp = launches_created[0].conta_id if launches_created else None
            
            l_desp = Lancamento(
                descricao=f"Despesa Extra ({ed['label']}) RV-AUTOGERADO - {descricao_geral[:150]}",
                tipo="DESPESA",
                status=desp_status,
                origem="PDV",
                valor_previsto=ed["valor"],
                valor_pago=desp_valor_pago,
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00"),
                valor_multa=Decimal("0.00"),
                data_vencimento=launches_created[0].data_vencimento if launches_created else hoje_pag,
                data_pagamento=launches_created[0].data_pagamento if (launches_created and desp_status == "PAGO") else None,
                data_competencia=launches_created[0].data_competencia if launches_created else hoje_pag,
                empresa_id=empresa_id,
                plano_contas_id=ed["plano_contas_id"],
                conta_id=conta_id_desp,
                entidade_id=venda_in.entidade_id,
                centro_custo_id=venda_in.centro_custo_id,
                created_by_id=venda_in.vendedor_id,
                updated_by_id=current_user_id,
                observacao=json.dumps(obs_data_desp),
                is_deleted=False,
                ipp=False,
                previsto=True,
                conciliado=False,
                id_parcelamento=venda_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(l_desp)
            launches_created.append(l_desp)

        db.flush()
        if launches_created:
            first_launch = launches_created[0]
            rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{first_launch.id:06d}"
        else:
            import random
            rand_id = random.randint(100000, 999999)
            rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{rand_id:06d}"
        
        for an in old_anexos:
            if venda_in.comprovante_urls is not None and an.url not in venda_in.comprovante_urls:
                an.is_deleted = True
                an.deleted_at = datetime.utcnow()
                an.deleted_by_id = current_user_id
            else:
                if launches_created:
                    an.lancamento_id = first_launch.id
            db.add(an)

        for l in launches_created:
            l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
            meta = json.loads(l.observacao)
            meta["rv"] = rv_code
            l.observacao = json.dumps(meta)
            if venda_in.import_hash:
                l.import_hash = venda_in.import_hash
            db.add(l)
            
        # 8. Processar movimentações de estoque
        alertas = PdvService.processar_estoque_venda(
            db, empresa_id, venda_id, itens_metadados, sale_status, current_user_id
        )

        # Recalcular custo médio e saldo para cada produto vendido
        for item in itens_metadados:
            produto_id = item.get("produto_id")
            if produto_id:
                PdvService.recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

        for l in launches_created:
            meta = json.loads(l.observacao)
            meta["itens"] = itens_metadados
            l.observacao = json.dumps(meta)
            db.add(l)

        db.flush()
        if launches_created:
            db.refresh(first_launch)
            data_registro = first_launch.data_pagamento or first_launch.data_vencimento or hoje_pag
            launch_id = int(first_launch.id or 0)
            launch_desc = first_launch.descricao
        else:
            data_registro = hoje_pag
            launch_id = 0
            launch_desc = f"Venda {rv_code} - {descricao_geral[:200]}"

        return PdvVendaItemRead(
            id=launch_id,
            rv=rv_code,
            data=data_registro,
            hora=datetime.utcnow().strftime("%H:%M"),
            vendedor=(vendedor.nome or vendedor.email),
            status=sale_status,
            descricao=launch_desc,
            valor=valor_final_venda,
            venda_id_uuid=venda_id,
            comprovante_url=old_comprovante_url,
            comprovante_urls=old_comprovante_urls,
            campos_extras=campos_extras_validados,
            alertas=alertas,
            is_direct_sale=venda_in.is_direct_sale
        )

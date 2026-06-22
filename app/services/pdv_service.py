# app/services/pdv_service.py
from __future__ import annotations
import json
import uuid
import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional
from fastapi import HTTPException
from sqlmodel import Session, select, col

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
    elif regra.tipo_prazo == "DIAS_UTEIS":
        vencimento = adicionar_dias_uteis(base_date, regra.dias_payout)
    else:  # DIAS_CORRIDOS
        vencimento = base_date + timedelta(days=regra.dias_payout)
        
    # 2. Rolar para o próximo dia útil se cair no final de semana
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


def obter_regra_cartao(
    db: Session,
    empresa_id: int,
    tipo_pagamento: str,
    bandeira: str,
    centro_custo_id: Optional[int] = None
) -> Optional[RegraCartao]:
    bandeira_upper = bandeira.upper() if bandeira else "OUTROS"
    
    # 1. Tentar correspondência exata: tipo, bandeira e centro de custo
    if centro_custo_id:
        regra = db.exec(
            select(RegraCartao)
            .where(
                RegraCartao.empresa_id == empresa_id,
                RegraCartao.tipo_pagamento == tipo_pagamento,
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
            RegraCartao.tipo_pagamento == tipo_pagamento,
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


class PdvService:
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
        # 1. Validar se o vendedor_id pertence à mesma empresa
        vendedor = db.get(Usuario, venda_in.vendedor_id)
        if not vendedor or (vendedor.empresa_id != empresa_id and vendedor.empresa_id is not None) or vendedor.is_deleted:
            raise HTTPException(status_code=400, detail="Vendedor inválido para esta empresa.")
            
        # 1.2 Validar se o cliente (entidade_id) pertence à mesma empresa
        entidade = db.get(Entidade, venda_in.entidade_id)
        if not entidade or entidade.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Cliente inválido.")

        # 1.3 Validar se o centro de custo pertence à mesma empresa
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
            descricao_itens.append(f"{produto.nome} x{item.quantidade}")
            itens_metadados.append({
                "produto_id": produto.id,
                "nome": produto.nome,
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
        
        pdv_venda_id = str(uuid.uuid4())
        sale_status = venda_in.status.upper()
        
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
            "comprovante_urls": []
        }
        
        launches_created = []
        desconto_ja_atribuido = False

        # 7. Criar os lançamentos financeiros correspondentes a cada pagamento
        for p in venda_in.pagamentos:
            plano_id = int(config_categorias.get(p.tipo_pagamento) or plano_fallback_id)
            conta_id_str = config_contas.get(p.tipo_pagamento)
            conta_id = int(conta_id_str) if conta_id_str else None

            hoje_pag = p.data_pagamento if p.data_pagamento else (venda_in.data_pagamento if venda_in.data_pagamento else datetime.utcnow().date())

            if sale_status == "ORCAMENTO":
                is_paid = False
            else:
                is_paid = config_marcar_como_pago.get(
                    p.tipo_pagamento,
                    p.tipo_pagamento in ["dinheiro", "pix_chave", "pix_qr", "cartao_credito_vista"]
                )

            # Buscar regra de cartão se houver
            regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
            if regra:
                is_paid = False
                if regra.conta_destino_id:
                    conta_id = regra.conta_destino_id

            if is_paid and not conta_id:
                conta_id = obter_conta_caixa_fisica(db, empresa_id)

            is_parcelada = False
            formas_config = pdv_config_dict.get("formas_pagamento", [])
            matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
            if matched_forma:
                is_parcelada = matched_forma.get("parcelada", False)
            else:
                is_parcelada = p.tipo_pagamento in ["cartao_credito_parcelado", "boleto"]

            if is_parcelada and p.numero_parcelas and p.numero_parcelas > 1:
                num_parc = int(p.numero_parcelas)
                total_pag = Decimal(p.valor)
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
                        year = hoje_pag.year + (hoje_pag.month - 1 + i) // 12
                        month = (hoje_pag.month - 1 + i) % 12 + 1
                        day = min(hoje_pag.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
                        vencimento = date(year, month, day)
                        fee_percentage = Decimal("0.00")

                    valor_linha = base_val if i < num_parc else last_val
                    
                    obs_data = dados_observacao_base.copy()
                    obs_data["tipo_pagamento"] = p.tipo_pagamento
                    obs_data["numero_parcela"] = i
                    obs_data["total_parcelas"] = num_parc
                    if regra:
                        fee_amount = (valor_linha * fee_percentage / 100).quantize(Decimal("0.01"))
                        liquid_value = valor_linha - fee_amount
                        obs_data["bandeira"] = regra.bandeira
                        obs_data["cartao_taxa"] = float(fee_percentage)
                        obs_data["cartao_taxa_valor"] = float(fee_amount)
                        obs_data["cartao_liquido_previsto"] = float(liquid_value)
                        obs_data["cartao_regra_id"] = regra.id

                    l = Lancamento(
                        descricao=f"Venda RV-AUTOGERADO ({i}/{num_parc}) - {descricao_geral[:150]}",
                        tipo="RECEITA",
                        status="PAGO" if is_paid else "EM ABERTO",
                        origem="PDV",
                        valor_previsto=valor_linha,
                        valor_pago=valor_linha if is_paid else Decimal("0.00"),
                        valor_juros=Decimal("0.00"),
                        valor_desconto=Decimal("0.00") if desconto_ja_atribuido or i > 1 else venda_in.desconto,
                        valor_multa=Decimal("0.00"),
                        data_vencimento=vencimento,
                        data_pagamento=hoje_pag if is_paid else None,
                        data_competencia=hoje_pag,
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
                        numero_parcela=i,
                        id_parcelamento=pdv_venda_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(l)
                    launches_created.append(l)
                desconto_ja_atribuido = True
            else:
                if regra:
                    vencimento = calcular_payout_date(hoje_pag, regra)
                    fee_percentage = regra.taxa_porcentagem
                    fee_amount = (p.valor * fee_percentage / 100).quantize(Decimal("0.01"))
                    liquid_value = p.valor - fee_amount
                else:
                    vencimento = hoje_pag
                    fee_percentage = Decimal("0.00")
                    fee_amount = Decimal("0.00")
                    liquid_value = p.valor

                obs_data = dados_observacao_base.copy()
                obs_data["tipo_pagamento"] = p.tipo_pagamento
                if regra:
                    obs_data["bandeira"] = regra.bandeira
                    obs_data["cartao_taxa"] = float(fee_percentage)
                    obs_data["cartao_taxa_valor"] = float(fee_amount)
                    obs_data["cartao_liquido_previsto"] = float(liquid_value)
                    obs_data["cartao_regra_id"] = regra.id

                l = Lancamento(
                    descricao=f"Venda RV-AUTOGERADO - {descricao_geral[:200]}",
                    tipo="RECEITA",
                    status="PAGO" if is_paid else "EM ABERTO",
                    origem="PDV",
                    valor_previsto=p.valor,
                    valor_pago=p.valor if is_paid else Decimal("0.00"),
                    valor_juros=Decimal("0.00"),
                    valor_desconto=Decimal("0.00") if desconto_ja_atribuido else venda_in.desconto,
                    valor_multa=Decimal("0.00"),
                    data_vencimento=vencimento,
                    data_pagamento=hoje_pag if is_paid else None,
                    data_competencia=hoje_pag,
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
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(l)
                launches_created.append(l)
                desconto_ja_atribuido = True

        db.flush()
        
        first_launch = launches_created[0]
        rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{first_launch.id:06d}"
        
        for l in launches_created:
            l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
            meta = json.loads(l.observacao)
            meta["rv"] = rv_code
            l.observacao = json.dumps(meta)
            db.add(l)
            
        db.flush()
        db.refresh(first_launch)

        data_registro = first_launch.data_pagamento or first_launch.data_vencimento or hoje_pag

        return PdvVendaItemRead(
            id=int(first_launch.id or 0),
            rv=rv_code,
            data=data_registro,
            hora=datetime.utcnow().strftime("%H:%M"),
            vendedor=(vendedor.nome or vendedor.email),
            status=sale_status,
            descricao=first_launch.descricao,
            valor=valor_final_venda,
            venda_id_uuid=pdv_venda_id,
            comprovante_url=None,
            comprovante_urls=[]
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
        # 1. Validar se a venda existe
        launches_antigos = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "PDV",
                Lancamento.id_parcelamento == venda_id
            )
        ).all()
        if not launches_antigos:
            raise HTTPException(status_code=404, detail="Venda não encontrada.")

        # 2. Validar vendedor, cliente e centro de custo
        vendedor = db.get(Usuario, venda_in.vendedor_id)
        if not vendedor or (vendedor.empresa_id != empresa_id and vendedor.empresa_id is not None) or vendedor.is_deleted:
            raise HTTPException(status_code=400, detail="Vendedor inválido para esta empresa.")
            
        entidade = db.get(Entidade, venda_in.entidade_id)
        if not entidad or entidade.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Cliente inválido.")

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
            descricao_itens.append(f"{produto.nome} x{item.quantidade}")
            itens_metadados.append({
                "produto_id": produto.id,
                "nome": produto.nome,
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
            "comprovante_urls": old_comprovante_urls
        }
        
        launches_created = []
        desconto_ja_atribuido = False

        for p in venda_in.pagamentos:
            plano_id = int(config_categorias.get(p.tipo_pagamento) or plano_fallback_id)
            conta_id_str = config_contas.get(p.tipo_pagamento)
            conta_id = int(conta_id_str) if conta_id_str else None

            hoje_pag = p.data_pagamento if p.data_pagamento else (venda_in.data_pagamento if venda_in.data_pagamento else datetime.utcnow().date())

            if sale_status == "ORCAMENTO":
                is_paid = False
            else:
                is_paid = config_marcar_como_pago.get(
                    p.tipo_pagamento,
                    p.tipo_pagamento in ["dinheiro", "pix_chave", "pix_qr", "cartao_credito_vista"]
                )

            regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
            if regra:
                is_paid = False
                if regra.conta_destino_id:
                    conta_id = regra.conta_destino_id

            if is_paid and not conta_id:
                conta_id = obter_conta_caixa_fisica(db, empresa_id)

            is_parcelada = False
            formas_config = pdv_config_dict.get("formas_pagamento", [])
            matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
            if matched_forma:
                is_parcelada = matched_forma.get("parcelada", False)
            else:
                is_parcelada = p.tipo_pagamento in ["cartao_credito_parcelado", "boleto"]

            if is_parcelada and p.numero_parcelas and p.numero_parcelas > 1:
                num_parc = int(p.numero_parcelas)
                total_pag = Decimal(p.valor)
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
                        year = hoje_pag.year + (hoje_pag.month - 1 + i) // 12
                        month = (hoje_pag.month - 1 + i) % 12 + 1
                        day = min(hoje_pag.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
                        vencimento = date(year, month, day)
                        fee_percentage = Decimal("0.00")

                    valor_linha = base_val if i < num_parc else last_val
                    
                    obs_data = dados_observacao_base.copy()
                    obs_data["tipo_pagamento"] = p.tipo_pagamento
                    obs_data["numero_parcela"] = i
                    obs_data["total_parcelas"] = num_parc
                    if regra:
                        fee_amount = (valor_linha * fee_percentage / 100).quantize(Decimal("0.01"))
                        liquid_value = valor_linha - fee_amount
                        obs_data["bandeira"] = regra.bandeira
                        obs_data["cartao_taxa"] = float(fee_percentage)
                        obs_data["cartao_taxa_valor"] = float(fee_amount)
                        obs_data["cartao_liquido_previsto"] = float(liquid_value)
                        obs_data["cartao_regra_id"] = regra.id

                    l = Lancamento(
                        descricao=f"Venda RV-AUTOGERADO ({i}/{num_parc}) - {descricao_geral[:150]}",
                        tipo="RECEITA",
                        status="PAGO" if is_paid else "EM ABERTO",
                        origem="PDV",
                        valor_previsto=valor_linha,
                        valor_pago=valor_linha if is_paid else Decimal("0.00"),
                        valor_juros=Decimal("0.00"),
                        valor_desconto=Decimal("0.00") if desconto_ja_atribuido or i > 1 else venda_in.desconto,
                        valor_multa=Decimal("0.00"),
                        data_vencimento=vencimento,
                        data_pagamento=hoje_pag if is_paid else None,
                        data_competencia=hoje_pag,
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
                        numero_parcela=i,
                        id_parcelamento=venda_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(l)
                    launches_created.append(l)
                desconto_ja_atribuido = True
            else:
                if regra:
                    vencimento = calcular_payout_date(hoje_pag, regra)
                    fee_percentage = regra.taxa_porcentagem
                    fee_amount = (p.valor * fee_percentage / 100).quantize(Decimal("0.01"))
                    liquid_value = p.valor - fee_amount
                else:
                    vencimento = hoje_pag
                    fee_percentage = Decimal("0.00")
                    fee_amount = Decimal("0.00")
                    liquid_value = p.valor

                obs_data = dados_observacao_base.copy()
                obs_data["tipo_pagamento"] = p.tipo_pagamento
                if regra:
                    obs_data["bandeira"] = regra.bandeira
                    obs_data["cartao_taxa"] = float(fee_percentage)
                    obs_data["cartao_taxa_valor"] = float(fee_amount)
                    obs_data["cartao_liquido_previsto"] = float(liquid_value)
                    obs_data["cartao_regra_id"] = regra.id

                l = Lancamento(
                    descricao=f"Venda RV-AUTOGERADO - {descricao_geral[:200]}",
                    tipo="RECEITA",
                    status="PAGO" if is_paid else "EM ABERTO",
                    origem="PDV",
                    valor_previsto=p.valor,
                    valor_pago=p.valor if is_paid else Decimal("0.00"),
                    valor_juros=Decimal("0.00"),
                    valor_desconto=Decimal("0.00") if desconto_ja_atribuido else venda_in.desconto,
                    valor_multa=Decimal("0.00"),
                    data_vencimento=vencimento,
                    data_pagamento=hoje_pag if is_paid else None,
                    data_competencia=hoje_pag,
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
                    id_parcelamento=venda_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(l)
                launches_created.append(l)
                desconto_ja_atribuido = True

        db.flush()
        first_launch = launches_created[0]
        rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{first_launch.id:06d}"
        
        for an in old_anexos:
            if venda_in.comprovante_urls is not None and an.url not in venda_in.comprovante_urls:
                an.is_deleted = True
                an.deleted_at = datetime.utcnow()
                an.deleted_by_id = current_user_id
            else:
                an.lancamento_id = first_launch.id
            db.add(an)

        for l in launches_created:
            l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
            meta = json.loads(l.observacao)
            meta["rv"] = rv_code
            l.observacao = json.dumps(meta)
            db.add(l)
            
        db.flush()
        db.refresh(first_launch)

        data_registro = first_launch.data_pagamento or first_launch.data_vencimento or hoje_pag

        return PdvVendaItemRead(
            id=int(first_launch.id or 0),
            rv=rv_code,
            data=data_registro,
            hora=datetime.utcnow().strftime("%H:%M"),
            vendedor=(vendedor.nome or vendedor.email),
            status=sale_status,
            descricao=first_launch.descricao,
            valor=valor_final_venda,
            venda_id_uuid=venda_id,
            comprovante_url=old_comprovante_url,
            comprovante_urls=old_comprovante_urls
        )

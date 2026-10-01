# app/services/pdv/venda_service.py
from __future__ import annotations
import re
import json
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any
from fastapi import HTTPException
from sqlmodel import Session, select, col, delete

from app.models.lancamento import Lancamento
from app.models.usuario import Usuario
from app.models.produto import Produto
from app.models.plano_contas import PlanoContas
from app.models.empresa import Empresa
from app.models.conta import Conta
from app.models.anexo_lancamento import AnexoLancamento
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.schemas.pdv import (
    PdvVendaCreate,
    PdvVendaItemRead,
)
from app.services.pdv.cartao_service import (
    obter_conta_caixa_fisica,
    calcular_payout_date,
    shift_months,
    obter_categoria_pagamento,
    obter_regra_cartao,
    format_card_description,
    adicionar_ou_atualizar_recebivel_cartao_agrupado,
    remover_contribuicoes_venda,
    obter_categoria_taxas_cartao,
)
from app.services.pdv.estoque_service import (
    processar_estoque_venda,
    recalcular_estoque_e_custo_medio_produto,
)


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


def resolve_generic_products(db: Session, empresa_id: int, itens: List[Any]):
    from sqlalchemy import func
    
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


def validar_e_processar_campos_extras(
    db: Session,
    empresa_id: int,
    campos_extras: Optional[Dict[str, Any]],
    current_user_id: int
) -> Dict[str, Any]:
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
    campos_extras_validados = validar_e_processar_campos_extras(
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
                (Lancamento.referencia_externa == rv_stripped) | col(Lancamento.observacao).like(f'%"{rv_stripped}"%')
            )
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"O Registro de Venda (RV) '{rv_stripped}' já está em uso.")

    # 3. Buscar e calcular valores dos itens do produto
    resolve_generic_products(db, empresa_id, venda_in.itens)
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

    # 4. Validar se pagamentos batem com valor final
    total_pagamentos = sum(Decimal(p.valor) for p in venda_in.pagamentos)
    if abs(total_pagamentos - valor_final_venda) > Decimal("0.05"):
        raise HTTPException(
            status_code=400,
            detail=f"A soma dos pagamentos (R$ {total_pagamentos:.2f}) não condiz com o valor líquido da venda (R$ {valor_final_venda:.2f})."
        )

    # 5. Obter categoria fallback para lançamentos
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

    # 7. Criar os lançamentos financeiros vinculados
    sale_status = venda_in.status.upper()
    pdv_venda_id = str(uuid.uuid4())
    
    # Criar registro operacional PdvVenda
    venda_op = PdvVenda(
        id=pdv_venda_id,
        empresa_id=empresa_id,
        entidade_id=venda_in.entidade_id,
        vendedor_id=venda_in.vendedor_id,
        centro_custo_id=venda_in.centro_custo_id,
        data_venda=venda_in.data_pagamento or hoje_pag,
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

    # Criar itens operacionais PdvVendaItem
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
        "campos_extras": campos_extras_validados
    }
    
    launches_created = []
    movs_created = []
    desconto_ja_atribuido = False

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

        regra = obter_regra_cartao(db, empresa_id, p.tipo_pagamento, p.bandeira, venda_in.centro_custo_id)
        if regra:
            is_paid = False
            if regra.conta_destino_id:
                conta_id = regra.conta_destino_id

        if conta_id:
            conta_valida = db.exec(
                select(Conta)
                .where(Conta.id == conta_id, Conta.empresa_id == empresa_id)
            ).first()
            if not conta_valida:
                conta_id = None

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

            # Mapear forma de pagamento para caixa alta padrão
            forma_pag_mapeada = p.tipo_pagamento.upper()
            if "CREDITO_VISTA" in forma_pag_mapeada or "CREDITO_AVISTA" in forma_pag_mapeada or "CREDITO_AT_VISTA" in forma_pag_mapeada or forma_pag_mapeada in ["CARTAO_CREDITO_VISTA", "CREDITO"]:
                forma_pag_mapeada = "CREDITO_AVISTA"
            elif "CREDITO_PARCELADO" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_CREDITO_PARCELADO":
                forma_pag_mapeada = "CREDITO_PARCELADO"
            elif "DEBITO" in forma_pag_mapeada or forma_pag_mapeada == "CARTAO_DEBITO":
                forma_pag_mapeada = "DEBITO"

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
                    origem_tipo="pdv_venda",
                    origem_id=pdv_venda_id,
                    import_hash=hash_unico,
                    created_by_id=venda_in.vendedor_id,
                    updated_by_id=current_user_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(mov)
                movs_created.append(mov)

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

                hash_unico = f"{venda_in.import_hash}-P{i}" if (venda_in.import_hash and num_parc > 1) else (venda_in.import_hash if venda_in.import_hash else None)

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
                    referencia_externa=venda_in.rv.strip() if venda_in.rv else None,
                    tipo_origem="PDV_VENDA",
                    origem_uuid=pdv_venda_id,
                    observacao=json.dumps(obs_data),
                    is_deleted=False,
                    ipp=False,
                    previsto=True,
                    conciliado=False,
                    id_parcelamento=pdv_venda_id,
                    numero_parcela=i if num_parc > 1 else None,
                    import_hash=hash_unico,
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
                    origem_tipo="pdv_venda",
                    origem_id=pdv_venda_id,
                    import_hash=hash_unico,
                    created_by_id=venda_in.vendedor_id,
                    updated_by_id=current_user_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(mov)
                movs_created.append(mov)

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
            tipo_origem="PDV_DESPESA_EXTRA",
            origem_uuid=pdv_venda_id,
            observacao=f"Despesa Extra: {ed['label']}",
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
    
    clean_rv = rv_code.replace("RV-", "").replace("RV:", "").replace("RV ", "").strip()
    venda_op.rv = rv_code
    db.add(venda_op)

    for m in movs_created:
        if m.parcelas and m.parcelas > 1 and m.numero_parcela:
            m.descricao = f"Parcela {m.numero_parcela}/{m.parcelas} Venda RV: {clean_rv}"
        else:
            m.descricao = f"Venda RV: {clean_rv}"
        db.add(m)

    for l in launches_created:
        l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
        if not l.referencia_externa:
            l.referencia_externa = rv_code
        if venda_in.import_hash:
            l.import_hash = venda_in.import_hash
        db.add(l)
        
    # 8. Processar movimentações de estoque
    alertas = processar_estoque_venda(
        db, empresa_id, pdv_venda_id, itens_metadados, sale_status, current_user_id
    )

    # Recalcular custo médio e saldo para cada produto vendido
    for item in itens_metadados:
        produto_id = item.get("produto_id")
        if produto_id:
            recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

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
    campos_extras_validados = validar_e_processar_campos_extras(
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
                (Lancamento.referencia_externa == rv_stripped) | col(Lancamento.observacao).like(f'%"{rv_stripped}"%')
            )
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"O Registro de Venda (RV) '{rv_stripped}' já está em uso.")

    # 4. Calcular novos valores
    resolve_generic_products(db, empresa_id, venda_in.itens)
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
    movs_created = []
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
                    origem_tipo="pdv_venda",
                    origem_id=pdv_venda_id,
                    import_hash=hash_unico,
                    created_by_id=venda_in.vendedor_id,
                    updated_by_id=current_user_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(mov)
                movs_created.append(mov)

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
                    referencia_externa=venda_in.rv.strip() if venda_in.rv else None,
                    tipo_origem="PDV_VENDA",
                    origem_uuid=pdv_venda_id,
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
            tipo_origem="PDV_DESPESA_EXTRA",
            origem_uuid=venda_id,
            observacao=f"Despesa Extra: {ed['label']}",
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
    
    clean_rv = rv_code.replace("RV-", "").replace("RV:", "").replace("RV ", "").strip()
    venda_op.rv = rv_code
    db.add(venda_op)

    for m in movs_created:
        if m.parcelas and m.parcelas > 1 and m.numero_parcela:
            m.descricao = f"Parcela {m.numero_parcela}/{m.parcelas} Venda RV: {clean_rv}"
        else:
            m.descricao = f"Venda RV: {clean_rv}"
        db.add(m)

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
        if not l.referencia_externa:
            l.referencia_externa = rv_code
        if venda_in.import_hash:
            l.import_hash = venda_in.import_hash
        db.add(l)
        
    # 8. Processar movimentações de estoque
    alertas = processar_estoque_venda(
        db, empresa_id, venda_id, itens_metadados, sale_status, current_user_id
    )

    # Recalcular custo médio e saldo para cada produto vendido
    for item in itens_metadados:
        produto_id = item.get("produto_id")
        if produto_id:
            recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

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

# app/services/pdv/caixa_service.py
from __future__ import annotations
import json
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Dict, Any, Optional
from fastapi import HTTPException
from sqlmodel import Session, select, col

from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.pdv_venda import PdvVenda
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.services.periodo_service import PeriodoService
from app.services.pdv.cartao_service import obter_conta_caixa_fisica
from app.services.pdv.venda_service import criar_venda


def criar_movimentacao_caixa(
    db: Session,
    empresa_id: int,
    mov_in: Any,
    current_user_id: int
) -> Dict[str, Any]:
    # Resolve centro de custo
    cc_id = mov_in.centro_custo_id
    if not cc_id:
        empresa = db.get(Empresa, empresa_id)
        if empresa and empresa.pdv_config:
            try:
                config = json.loads(empresa.pdv_config)
                cc_id = config.get("pdv_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
            except Exception:
                pass
        if not cc_id:
            cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
            cc_id = cc.id if cc else None

    # Resolve conta de destino
    c_id = mov_in.conta_id
    if not c_id:
        empresa = db.get(Empresa, empresa_id)
        if empresa and empresa.pdv_config:
            try:
                config = json.loads(empresa.pdv_config)
                c_id = config.get("pdv_conta_padrao_id")
            except Exception:
                pass
        if not c_id:
            c_id = obter_conta_caixa_fisica(db, empresa_id)

    if mov_in.tipo == "ENTRADA":
        default_client = db.exec(
            select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.nome == "Cliente Consumidor")
        ).first()
        if not default_client:
            default_client = Entidade(
                nome="Cliente Consumidor",
                tipo="CLIENTE",
                empresa_id=empresa_id,
                is_active=True
            )
            db.add(default_client)
            db.flush()

        if mov_in.forma_pagamento == "DINHEIRO":
            pc_id = None
            empresa = db.get(Empresa, empresa_id)
            if empresa and empresa.pdv_config:
                try:
                    config = json.loads(empresa.pdv_config)
                    pc_id_str = config.get("categorias", {}).get("dinheiro")
                    if pc_id_str:
                        pc_id = int(pc_id_str)
                except Exception:
                    pass

            if not pc_id:
                pc_receita = db.exec(
                    select(PlanoContas)
                    .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "R", PlanoContas.permite_lancamentos == True)
                ).first()
                if not pc_receita:
                    pc_receita = PlanoContas(
                        nome="Receitas de Vendas",
                        tipo="R",
                        empresa_id=empresa_id,
                        permite_lancamentos=True,
                        codigo="1.01.01"
                    )
                    db.add(pc_receita)
                    db.flush()
                pc_id = pc_receita.id
            
            meta = {
                "is_movimentacao_pdv": True,
                "forma_pagamento": mov_in.forma_pagamento,
                "total_parcelas": 1
            }
            
            mov_uuid = f"mov_{uuid.uuid4()}"
            l = Lancamento(
                empresa_id=empresa_id,
                conta_id=c_id,
                plano_contas_id=pc_id,
                tipo="RECEITA",
                descricao=mov_in.descricao,
                valor_previsto=mov_in.valor,
                valor_pago=mov_in.valor,
                data_vencimento=mov_in.data,
                data_pagamento=mov_in.data,
                data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, mov_in.data),
                status="PAGO",
                entidade_id=default_client.id,
                centro_custo_id=cc_id,
                id_parcelamento=mov_uuid,
                observacao=json.dumps(meta, ensure_ascii=False)
            )
            l.created_by_id = current_user_id
            l.updated_by_id = current_user_id
            l.created_at = datetime.utcnow()
            l.updated_at = datetime.utcnow()
            db.add(l)
            db.flush()

            m_op = PdvMovimentacao(
                id=l.id,
                empresa_id=empresa_id,
                tipo="ENTRADA",
                descricao=mov_in.descricao,
                valor=mov_in.valor,
                forma_pagamento="DINHEIRO",
                bandeira="OUTROS",
                parcelas=1,
                data=mov_in.data,
                centro_custo_id=cc_id,
                conta_id=c_id,
                conciliado=False,
                venda_id=None,
                created_by_id=current_user_id,
                updated_by_id=current_user_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(m_op)
            db.commit()
            return {"status": "success", "id": m_op.id}
        else:
            tipo_pag_map = {
                "DEBITO": "cartao_debito",
                "CREDITO_AVISTA": "cartao_credito_vista",
                "CREDITO_PARCELADO": "cartao_credito_parcelado",
                "PIX": "pix_chave"
            }
            tipo_pag_backend = tipo_pag_map.get(mov_in.forma_pagamento, "cartao_debito")
            
            venda_in = PdvVendaCreate(
                entidade_id=default_client.id,
                centro_custo_id=cc_id,
                vendedor_id=current_user_id,
                desconto=Decimal("0.00"),
                status="REALIZADO",
                data=mov_in.data,
                data_pagamento=mov_in.data,
                itens=[
                    PdvVendaItemCreate(
                        produto_id=0,
                        quantidade=Decimal("1.00"),
                        preco_unitario=mov_in.valor,
                        nome_produto_avulso=mov_in.descricao
                    )
                ],
                pagamentos=[
                    PdvVendaPagamento(
                        tipo_pagamento=tipo_pag_backend,
                        valor=mov_in.valor,
                        numero_parcelas=mov_in.parcelas or 1,
                        bandeira=mov_in.bandeira or "OUTROS",
                        data_pagamento=mov_in.data
                    )
                ],
                observacao=mov_in.descricao
            )
            
            res_venda = criar_venda(
                db=db,
                venda_in=venda_in,
                empresa_id=empresa_id,
                current_user_id=current_user_id
            )
            
            venda_uuid = res_venda.venda_id_uuid
            lancamentos_criados = db.exec(
                select(Lancamento).where(Lancamento.id_parcelamento == venda_uuid)
            ).all()
            
            for l in lancamentos_criados:
                meta = {}
                if l.observacao:
                    try:
                        meta = json.loads(l.observacao)
                    except:
                        meta = {}
                meta["is_movimentacao_pdv"] = True
                meta["forma_pagamento"] = mov_in.forma_pagamento
                l.observacao = json.dumps(meta, ensure_ascii=False)
                db.add(l)

            db.commit()
            return {"status": "success", "id_parcelamento": venda_uuid}

    else:
        # SAÍDA (Sangria/Retirada simples)
        pc_id = None
        empresa = db.get(Empresa, empresa_id)
        if empresa and empresa.pdv_config:
            try:
                config = json.loads(empresa.pdv_config)
                pc_id_str = config.get("categorias", {}).get("sangria") or config.get("categorias", {}).get("despesa")
                if pc_id_str:
                    pc_id = int(pc_id_str)
            except Exception:
                pass

        if not pc_id:
            pc_desp = db.exec(
                select(PlanoContas)
                .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "D", PlanoContas.permite_lancamentos == True)
            ).first()
            if not pc_desp:
                pc_desp = PlanoContas(
                    nome="Despesas Operacionais",
                    tipo="D",
                    empresa_id=empresa_id,
                    permite_lancamentos=True,
                    codigo="2.01.01"
                )
                db.add(pc_desp)
                db.flush()
            pc_id = pc_desp.id
            
        default_forn = db.exec(
            select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.nome == "Sangria / Caixa")
        ).first()
        if not default_forn:
            default_forn = Entidade(
                nome="Sangria / Caixa",
                tipo="FORNECEDOR",
                empresa_id=empresa_id,
                is_active=True
            )
            db.add(default_forn)
            db.flush()

        meta = {
            "is_movimentacao_pdv": True,
            "forma_pagamento": "DINHEIRO",
            "total_parcelas": 1
        }

        mov_uuid = f"mov_{uuid.uuid4()}"
        l = Lancamento(
            empresa_id=empresa_id,
            conta_id=c_id,
            plano_contas_id=pc_id,
            tipo="DESPESA",
            descricao=mov_in.descricao,
            valor_previsto=mov_in.valor,
            valor_pago=mov_in.valor,
            data_vencimento=mov_in.data,
            data_pagamento=mov_in.data,
            data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, mov_in.data),
            status="PAGO",
            entidade_id=default_forn.id,
            centro_custo_id=cc_id,
            id_parcelamento=mov_uuid,
            observacao=json.dumps(meta, ensure_ascii=False)
        )
        l.created_by_id = current_user_id
        l.updated_by_id = current_user_id
        l.created_at = datetime.utcnow()
        l.updated_at = datetime.utcnow()
        db.add(l)
        db.flush()

        m_op = PdvMovimentacao(
            id=l.id,
            empresa_id=empresa_id,
            tipo="SAIDA",
            descricao=mov_in.descricao,
            valor=mov_in.valor,
            forma_pagamento="DINHEIRO",
            bandeira="OUTROS",
            parcelas=1,
            data=mov_in.data,
            centro_custo_id=cc_id,
            conta_id=c_id,
            conciliado=False,
            venda_id=None,
            created_by_id=current_user_id,
            updated_by_id=current_user_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(m_op)
        db.commit()
        return {"status": "success", "id": m_op.id}


def processar_sangria(
    db: Session,
    empresa_id: int,
    sangria_in: Any,
    current_user_id: int
) -> Dict[str, Any]:
    """
    Executa sangria do caixa físico do PDV para uma conta bancária de destino.
    """
    conta_destino = db.get(Conta, sangria_in.conta_destino_id)
    if not conta_destino or conta_destino.empresa_id != empresa_id:
        raise HTTPException(status_code=404, detail="Conta bancária de destino não encontrada.")

    empresa = db.get(Empresa, empresa_id)
    pdv_conta_id = None
    if empresa and empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
            pdv_conta_id = config.get("pdv_conta_padrao_id")
        except Exception:
            pass
            
    if not pdv_conta_id:
        pdv_conta_id = obter_conta_caixa_fisica(db, empresa_id)
        
    saida_pc_id = None
    if empresa and empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
            saida_pc_str = config.get("categorias", {}).get("sangria") or config.get("categorias", {}).get("despesa")
            if saida_pc_str:
                saida_pc_id = int(saida_pc_str)
        except Exception:
            pass

    if not saida_pc_id:
        pc_desp = db.exec(
            select(PlanoContas)
            .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "D", PlanoContas.permite_lancamentos == True)
        ).first()
        if not pc_desp:
            pc_desp = PlanoContas(
                nome="Despesas Operacionais",
                tipo="D",
                empresa_id=empresa_id,
                permite_lancamentos=True,
                codigo="2.01.01"
            )
            db.add(pc_desp)
            db.flush()
        saida_pc_id = pc_desp.id

    entrada_pc_id = None
    if empresa and empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
            entrada_pc_str = config.get("categorias", {}).get("dinheiro") or config.get("pdv_plano_contas_receita_id")
            if entrada_pc_str:
                entrada_pc_id = int(entrada_pc_str)
        except Exception:
            pass

    if not entrada_pc_id:
        pc_rec = db.exec(
            select(PlanoContas)
            .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "R", PlanoContas.permite_lancamentos == True)
        ).first()
        if not pc_rec:
            pc_rec = PlanoContas(
                nome="Receitas de Vendas",
                tipo="R",
                empresa_id=empresa_id,
                permite_lancamentos=True,
                codigo="1.01.01"
            )
            db.add(pc_rec)
            db.flush()
        entrada_pc_id = pc_rec.id

    cc_id = None
    if empresa and empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
            cc_id = config.get("pdv_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
        except Exception:
            pass
            
    if not cc_id:
        cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
        cc_id = cc.id if cc else None

    venda_uuid = f"sangria_{uuid.uuid4()}"
    data_str = sangria_in.data.strftime("%d/%m/%Y")
    competencia_str = f"{sangria_in.data.month:02d}-{sangria_in.data.year}"

    default_supplier = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.nome == "Sangria"
        )
    ).first()
    if not default_supplier:
        default_supplier = Entidade(
            nome="Sangria",
            tipo="FORNECEDOR",
            empresa_id=empresa_id
        )
        db.add(default_supplier)
        db.flush()

    meta_saida = {
        "is_movimentacao_pdv": True,
        "forma_pagamento": "DINHEIRO",
        "total_parcelas": 1,
        "is_sangria": True,
        "sangria_uuid": venda_uuid
    }
    
    desc_saida = f"Sangria {data_str}"
    if sangria_in.descricao and sangria_in.descricao != "Sangria de Caixa":
        desc_saida = f"{sangria_in.descricao} {data_str}"
        
    l_saida = Lancamento(
        empresa_id=empresa_id,
        conta_id=pdv_conta_id,
        plano_contas_id=saida_pc_id,
        tipo="DESPESA",
        descricao=desc_saida,
        valor_previsto=sangria_in.valor,
        valor_pago=sangria_in.valor,
        data_vencimento=sangria_in.data,
        data_pagamento=sangria_in.data,
        data_competencia=sangria_in.data,
        competencia=competencia_str,
        status="PAGO",
        entidade_id=default_supplier.id,
        centro_custo_id=cc_id,
        id_parcelamento=venda_uuid,
        tipo_origem="PDV_SANGRIA_SAIDA",
        origem_uuid=venda_uuid,
        observacao=json.dumps(meta_saida, ensure_ascii=False)
    )
    l_saida.created_by_id = current_user_id
    l_saida.updated_by_id = current_user_id
    l_saida.created_at = datetime.utcnow()
    l_saida.updated_at = datetime.utcnow()
    db.add(l_saida)
    db.flush()

    m_op = PdvMovimentacao(
        id=l_saida.id,
        empresa_id=empresa_id,
        tipo="SAIDA",
        descricao=desc_saida,
        valor=sangria_in.valor,
        forma_pagamento="DINHEIRO",
        bandeira="OUTROS",
        parcelas=1,
        data=sangria_in.data,
        centro_custo_id=cc_id,
        conta_id=pdv_conta_id,
        conciliado=False,
        venda_id=None,
        created_by_id=current_user_id,
        updated_by_id=current_user_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(m_op)

    meta_entrada = {
        "is_sangria_entrada": True,
        "origem_conta_id": pdv_conta_id,
        "sangria_uuid": venda_uuid
    }
    
    desc_entrada = f"Sangria {data_str}"
    if sangria_in.descricao and sangria_in.descricao != "Sangria de Caixa":
        desc_entrada = f"{sangria_in.descricao} {data_str}"

    default_client = db.exec(
        select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.nome == "Cliente Consumidor")
    ).first()
    if not default_client:
        default_client = Entidade(
            nome="Cliente Consumidor",
            tipo="CLIENTE",
            empresa_id=empresa_id
        )
        db.add(default_client)
        db.flush()

    l_entrada = Lancamento(
        empresa_id=empresa_id,
        conta_id=sangria_in.conta_destino_id,
        plano_contas_id=entrada_pc_id,
        tipo="RECEITA",
        descricao=desc_entrada,
        valor_previsto=sangria_in.valor,
        valor_pago=sangria_in.valor,
        data_vencimento=sangria_in.data,
        data_pagamento=sangria_in.data,
        data_competencia=sangria_in.data,
        competencia=competencia_str,
        status="PAGO",
        entidade_id=default_client.id,
        centro_custo_id=cc_id,
        id_parcelamento=venda_uuid,
        tipo_origem="PDV_SANGRIA_ENTRADA",
        origem_uuid=venda_uuid,
        observacao=json.dumps(meta_entrada, ensure_ascii=False)
    )
    l_entrada.created_by_id = current_user_id
    l_entrada.updated_by_id = current_user_id
    l_entrada.created_at = datetime.utcnow()
    l_entrada.updated_at = datetime.utcnow()
    db.add(l_entrada)
    db.commit()

    return {
        "status": "success",
        "id_saida": l_saida.id,
        "id_entrada": l_entrada.id,
        "valor": float(sangria_in.valor)
    }

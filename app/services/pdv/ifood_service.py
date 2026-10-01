# app/services/pdv/ifood_service.py
from __future__ import annotations
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, Any, List
from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.pdv_ifood_lancamento import PdvIfoodLancamento
from app.models.conta import Conta
from app.models.empresa import Empresa
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.services.periodo_service import PeriodoService
from app.services.pdv.venda_service import obter_categoria_taxas_delivery


def criar_transacao_ifood(
    db: Session,
    transacao_in: Any,
    empresa_id: int,
    current_user_id: int
) -> PdvIfoodLancamento:
    """
    Grava uma nova transação individual do iFood.
    Calcula o valor líquido subtraindo a taxa de comissão salva nas configurações.
    Garante que origem_tipo e origem_id sejam persistidos no banco.
    """
    empresa = db.get(Empresa, empresa_id)
    taxa_pct = 12.0
    if empresa and empresa.pdv_config:
        try:
            cfg = json.loads(empresa.pdv_config)
            taxa_pct = float(cfg.get("ifood_comissao_taxa", 12.0))
        except Exception:
            pass

    taxa_comissao = Decimal(str(taxa_pct)) / Decimal("100.0")
    desconto_taxa = transacao_in.valor_bruto * taxa_comissao
    valor_liquido = transacao_in.valor_bruto - desconto_taxa
    
    if valor_liquido < 0:
        valor_liquido = Decimal("0.00")

    despesas_extras_str = ",".join(transacao_in.despesas_extras) if getattr(transacao_in, "despesas_extras", None) else None

    nova_transacao = PdvIfoodLancamento(
        empresa_id=empresa_id,
        forma_recebimento=transacao_in.forma_recebimento,
        valor_bruto=transacao_in.valor_bruto,
        valor_liquido=valor_liquido,
        data_venda=transacao_in.data_venda,
        hora_venda=getattr(transacao_in, "hora_venda", None) or datetime.now().strftime("%H:%M:%S"),
        data_recebimento_ajustada=transacao_in.data_recebimento_ajustada,
        despesas_extras_str=despesas_extras_str,
        status_conciliado=False,
        origem_tipo="pdv_ifood_lancamento",
    )
    
    nova_transacao.created_by_id = current_user_id
    nova_transacao.updated_by_id = current_user_id
    nova_transacao.created_at = datetime.utcnow()
    nova_transacao.updated_at = datetime.utcnow()
    
    db.add(nova_transacao)
    db.flush()

    nova_transacao.origem_id = str(nova_transacao.id)
    db.add(nova_transacao)
    db.commit()
    db.refresh(nova_transacao)
    
    return nova_transacao


def consolidar_transacoes_ifood(
    db: Session,
    empresa_id: int,
    data_venda: date,
    conta_id: int,
    current_user_id: int
) -> Dict[str, Any]:
    """
    Consolida as transações do iFood de um dia específico e as envia ao fluxo de caixa geral com split de taxas.
    """
    transacoes = db.exec(
        select(PdvIfoodLancamento)
        .where(
            PdvIfoodLancamento.empresa_id == empresa_id,
            PdvIfoodLancamento.data_venda == data_venda,
            PdvIfoodLancamento.status_conciliado == False,
            PdvIfoodLancamento.is_deleted == False
        )
    ).all()
    
    if not transacoes:
        raise HTTPException(status_code=400, detail="Nenhuma transação pendente encontrada para esta data.")
        
    total_bruto = sum(t.valor_bruto for t in transacoes)
    total_liquido = sum(t.valor_liquido for t in transacoes)
    total_taxa = total_bruto - total_liquido
    
    conta = db.get(Conta, conta_id)
    if not conta or conta.empresa_id != empresa_id:
        raise HTTPException(status_code=404, detail="Conta destino não encontrada.")
        
    data_recebimento = max(t.data_recebimento_ajustada for t in transacoes)
    
    # Sempre criar consolidados de iFood como EM ABERTO.
    status_l = "EM ABERTO"
    data_pagamento_l = None
    valor_pago_l = Decimal("0.00")

    desc = f"Repasse iFood Consolidado - Vendas {data_venda.strftime('%d/%m/%Y')}"
    
    # Resolver o centro de custo padrão da empresa a partir do pdv_config
    empresa = db.get(Empresa, empresa_id)
    centro_custo_id = None
    if empresa and empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
            centro_custo_id = config.get("ifood_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
        except Exception:
            pass
            
    if not centro_custo_id:
        cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
        centro_custo_id = cc.id if cc else None

    plano_contas = db.exec(
        select(PlanoContas)
        .where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "R",
            PlanoContas.permite_lancamentos == True
        )
    ).all()
    
    plano_id = None
    for pc in plano_contas:
        if "ifood" in pc.nome.lower():
            plano_id = pc.id
            break
            
    if not plano_id and plano_contas:
        plano_id = plano_contas[0].id

    # 1. Lançar Receita Bruta (EM ABERTO)
    consolidado_receita = Lancamento(
        empresa_id=empresa_id,
        conta_id=conta_id,
        plano_contas_id=plano_id,
        tipo="RECEITA",
        descricao=desc,
        valor_previsto=total_bruto,
        valor_pago=valor_pago_l,
        data_vencimento=data_recebimento,
        data_pagamento=data_pagamento_l,
        data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, data_venda),
        competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, data_venda).strftime("%m-%Y"),
        status=status_l,
        origem="IFOOD",
        id_parcelamento=None,
        centro_custo_id=centro_custo_id,
        tipo_origem="PDV_IFOOD_REPASSE",
        observacao=desc
    )
    consolidado_receita.created_by_id = current_user_id
    consolidado_receita.updated_by_id = current_user_id
    consolidado_receita.created_at = datetime.utcnow()
    consolidado_receita.updated_at = datetime.utcnow()
    
    db.add(consolidado_receita)
    db.flush()

    # Linkar o lote do id_parcelamento à receita principal
    consolidado_receita.id_parcelamento = consolidado_receita.id
    db.add(consolidado_receita)

    # 2. Lançar Comissão/Taxa como Despesa (EM ABERTO) se total_taxa > 0
    if total_taxa > 0:
        plano_taxa_delivery_id = obter_categoria_taxas_delivery(db, empresa_id)
        desc_taxa = f"Comissão/Taxa iFood - Vendas {data_venda.strftime('%d/%m/%Y')}"
        consolidado_despesa = Lancamento(
            empresa_id=empresa_id,
            conta_id=conta_id,
            plano_contas_id=plano_taxa_delivery_id,
            tipo="DESPESA",
            descricao=desc_taxa,
            valor_previsto=total_taxa,
            valor_pago=Decimal("0.00"),
            data_vencimento=data_recebimento,
            data_pagamento=None,
            data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, data_venda),
            competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, data_venda).strftime("%m-%Y"),
            status="EM ABERTO",
            origem="IFOOD",
            id_parcelamento=consolidado_receita.id,
            centro_custo_id=centro_custo_id,
            tipo_origem="PDV_IFOOD_TAXA",
            observacao=desc_taxa
        )
        consolidado_despesa.created_by_id = current_user_id
        consolidado_despesa.updated_by_id = current_user_id
        consolidado_despesa.created_at = datetime.utcnow()
        consolidado_despesa.updated_at = datetime.utcnow()
        db.add(consolidado_despesa)
    
    # 3. Vincular as transações ao lançamento consolidado receita
    for t in transacoes:
        t.status_conciliado = True
        t.lancamento_consolidado_id = consolidado_receita.id
        t.updated_by_id = current_user_id
        t.updated_at = datetime.utcnow()
        db.add(t)
        
    db.commit()
    return {
        "status": "success",
        "lancamento_id": consolidado_receita.id,
        "valor_consolidado": float(total_liquido)
    }

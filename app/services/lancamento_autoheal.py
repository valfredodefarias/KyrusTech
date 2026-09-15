# app/services/lancamento_autoheal.py
import json
from typing import Optional
from sqlmodel import Session
from app.models.lancamento import Lancamento


def auto_heal_lancamento(lanc: Lancamento, db: Session) -> bool:
    """
    Detecta se um Lancamento histórico ainda possui metadados em JSON serializados
    dentro do campo `observacao`. Se detectar, extrai e popula as colunas nativas:
    - `lote_cartao_id`
    - `tipo_origem`
    - `origem_uuid`
    - `referencia_externa`
    
    Substitui `observacao` pelo texto real do usuário (ou None se eram puramente metadados de sistema),
    garantindo que o banco seja auto-higienizado progressivamente.
    """
    if not lanc.observacao or not isinstance(lanc.observacao, str):
        return False

    trimmed = lanc.observacao.strip()
    if not (trimmed.startswith("{") and trimmed.endswith("}")):
        return False

    try:
        data = json.loads(trimmed)
    except Exception:
        return False

    if not isinstance(data, dict):
        return False

    changed = False

    # 1. Lote de Cartão e Conciliação
    if "lote_cartao_id" in data and isinstance(data["lote_cartao_id"], int):
        if not lanc.lote_cartao_id:
            lanc.lote_cartao_id = data["lote_cartao_id"]
            changed = True
        if not lanc.tipo_origem:
            if data.get("conciliacao_faturamento"):
                lanc.tipo_origem = "PDV_CONCILIACAO_FATURAMENTO"
            elif data.get("conciliacao_taxa"):
                lanc.tipo_origem = "PDV_CONCILIACAO_TAXA"
            changed = True

    # 2. Agrupamento de Cartões
    if data.get("grouped_card_launch"):
        if not lanc.tipo_origem:
            lanc.tipo_origem = "PDV_CARTAO_AGRUPADO"
            changed = True

    # 3. Sangrias
    if data.get("is_sangria"):
        if not lanc.tipo_origem:
            lanc.tipo_origem = "PDV_SANGRIA_SAIDA"
            changed = True
        if data.get("sangria_uuid") and not lanc.origem_uuid:
            lanc.origem_uuid = str(data["sangria_uuid"])
            changed = True
    elif data.get("is_sangria_entrada"):
        if not lanc.tipo_origem:
            lanc.tipo_origem = "PDV_SANGRIA_ENTRADA"
            changed = True
        if data.get("sangria_uuid") and not lanc.origem_uuid:
            lanc.origem_uuid = str(data["sangria_uuid"])
            changed = True

    # 4. iFood
    if data.get("ifood_consolidado"):
        if not lanc.tipo_origem:
            lanc.tipo_origem = "PDV_IFOOD_REPASSE"
            changed = True
    elif data.get("ifood_consolidado_taxa"):
        if not lanc.tipo_origem:
            lanc.tipo_origem = "PDV_IFOOD_TAXA"
            changed = True

    # 5. RV de Venda PDV
    if "rv" in data and data["rv"] and not lanc.referencia_externa:
        lanc.referencia_externa = str(data["rv"]).strip()
        changed = True

    # Se havia notas de usuário embutidas no JSON, preserva no campo observacao real
    user_notes = data.get("user_notes") or data.get("codigo_barras")
    if user_notes:
        lanc.observacao = str(user_notes)
        changed = True
    else:
        # Eram apenas metadados técnicos de sistema: limpa a observação!
        lanc.observacao = None
        changed = True

    if changed:
        db.add(lanc)

    return changed

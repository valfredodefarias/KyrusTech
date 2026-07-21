import json
from decimal import Decimal
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.empresa import Empresa
from app.services.pdv_service import obter_categoria_pagamento

def run():
    session = Session(engine)
    
    # 1. Obter config_categorias da empresa 35
    empresa = session.get(Empresa, 35)
    pdv_config_dict = {}
    if empresa and empresa.pdv_config:
        try:
            pdv_config_dict = json.loads(empresa.pdv_config)
        except Exception as e:
            print("Erro ao decodificar pdv_config:", e)
            
    config_categorias = pdv_config_dict.get("categorias", {})
    plano_fallback_id = int(pdv_config_dict.get("pdv_sangria_entrada_plano_contas_id") or 6305)
    
    # 2. Buscar lançamentos do dia 2026-07-21 da empresa 35 (Umarizal)
    lances = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.data_vencimento == '2026-07-21',
            Lancamento.is_deleted == False
        )
    ).all()
    
    updated_count = 0
    for l in lances:
        tipo_pagamento = None
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
                tipo_pagamento = meta.get("tipo_pagamento")
            except:
                pass
                
        if not tipo_pagamento:
            continue
            
        # Calcular categoria correta
        nova_categoria = obter_categoria_pagamento(session, 35, tipo_pagamento, config_categorias, plano_fallback_id)
        
        # Se mudou a categoria
        changed = False
        if l.plano_contas_id != nova_categoria:
            print(f"Lançamento {l.id} ({l.descricao}): Categoria {l.plano_contas_id} -> {nova_categoria}")
            l.plano_contas_id = nova_categoria
            changed = True
            
        # Se for pix ou dinheiro, marcar como PAGO
        if tipo_pagamento in ["dinheiro", "pix_chave", "pix_qr"]:
            if l.status != "PAGO":
                print(f"Lançamento {l.id} ({l.descricao}): Status {l.status} -> PAGO")
                l.status = "PAGO"
                l.valor_pago = l.valor_previsto
                l.data_pagamento = l.data_competencia
                changed = True
                
        if changed:
            session.add(l)
            updated_count += 1
            
    session.commit()
    print(f"Sucesso! {updated_count} lançamentos de hoje da Pizza Fábio Umarizal foram atualizados.")

if __name__ == "__main__":
    run()

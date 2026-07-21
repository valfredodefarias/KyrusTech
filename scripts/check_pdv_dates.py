from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
import json

def run():
    session = Session(engine)
    
    # Umarizal (35)
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.origem == "PDV",
            Lancamento.is_deleted == False
        )
    ).all()
    
    print(f"Total de lançamentos PDV: {len(launches)}")
    
    # Mapeamento de datas para as primeiras 15 vendas de cartão
    card_launches = [l for l in launches if "cartao" in str(l.descricao).lower() or "cartão" in str(l.descricao).lower()][:15]
    
    print("\n--- Datas de Lançamentos de Cartão (PDV) ---")
    for l in card_launches:
        # Extrair data da venda da observação
        obs_data = {}
        try:
            obs_data = json.loads(l.observacao)
        except:
            pass
            
        print(f"  ID: {l.id} | Vencimento: {l.data_vencimento} | Pagamento: {l.data_pagamento} | Competência: {l.data_competencia} | Valor: R$ {l.valor_previsto:.2f}")
        # Se tiver data da venda em obs_data (ex: rv ou itens)
        print(f"    Obs keys: {list(obs_data.keys())}")

if __name__ == "__main__":
    run()

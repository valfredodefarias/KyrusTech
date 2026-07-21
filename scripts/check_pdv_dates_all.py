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
    
    print("\n--- Datas de Lançamentos (PDV) ---")
    for l in launches[:20]:
        print(f"  ID: {l.id} | Desc: '{l.descricao}' | Vencimento: {l.data_vencimento} | Pagamento: {l.data_pagamento} | Competência: {l.data_competencia} | Valor: R$ {l.valor_previsto:.2f}")

if __name__ == "__main__":
    run()

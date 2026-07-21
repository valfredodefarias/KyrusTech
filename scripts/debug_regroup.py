import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento

def run():
    session = Session(engine)
    
    print("=== LANÇAMENTOS COM VENCIMENTO EM 2026-07-21 ===")
    lances = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.data_vencimento == '2026-07-21'
        )
    ).all()
    
    for l in lances:
        tipo_pag = "Desconhecido"
        if l.observacao:
            try:
                tipo_pag = json.loads(l.observacao).get("tipo_pagamento", "N/A")
            except:
                pass
        print(f"ID: {l.id} | Desc: {l.descricao} | Valor: {l.valor_previsto} | Categoria: {l.plano_contas_id} | TipoPag: {tipo_pag} | Deleted: {l.is_deleted} | Origem: {l.origem}")
        
    print("\n=== LANÇAMENTOS COM VENCIMENTO EM 2026-07-22 ===")
    lances_amanha = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.data_vencimento == '2026-07-22'
        )
    ).all()
    
    for l in lances_amanha:
        tipo_pag = "Desconhecido"
        if l.observacao:
            try:
                tipo_pag = json.loads(l.observacao).get("tipo_pagamento", "N/A")
            except:
                pass
        print(f"ID: {l.id} | Desc: {l.descricao} | Valor: {l.valor_previsto} | Categoria: {l.plano_contas_id} | TipoPag: {tipo_pag} | Deleted: {l.is_deleted} | Origem: {l.origem}")

if __name__ == "__main__":
    run()

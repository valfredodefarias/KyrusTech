from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento

def run():
    session = Session(engine)
    
    # 1. Contar lançamentos com "legacy_id_venda" na observacao
    count_legacy = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.is_deleted == False,
            Lancamento.observacao.like('%legacy_id_venda%')
        )
    ).all()
    print(f"Total de lançamentos ativos com 'legacy_id_venda' na obs: {len(count_legacy)}")
    
    # 2. Contar lançamentos de origem PDV
    count_pdv = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV"
        )
    ).all()
    print(f"Total de lançamentos ativos de origem PDV: {len(count_pdv)}")
    
    # Mostrar os primeiros 5 lançamentos de origem PDV e sua observacao
    print("\n--- Primeiros 5 lançamentos PDV ---")
    for l in count_pdv[:5]:
        print(f"  ID: {l.id} | Desc: '{l.descricao}' | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()

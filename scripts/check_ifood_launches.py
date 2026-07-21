from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from collections import Counter

def run():
    session = Session(engine)
    
    # Umarizal (35)
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.is_deleted == False
        )
    ).all()
    
    print(f"Total de lançamentos ativos para Empresa 35: {len(launches)}")
    
    # Contar por origem
    counts = Counter(l.origem for l in launches)
    print("\n--- Por Origem ---")
    for orig, cnt in counts.items():
        print(f"  Origem '{orig}': {cnt} lançamentos")
        
    # Buscar descrições ou observações contendo "ifood"
    ifood_launches = []
    for l in launches:
        desc = (l.descricao or "").lower()
        obs = (l.observacao or "").lower()
        if "ifood" in desc or "ifood" in obs:
            ifood_launches.append(l)
            
    print(f"\nTotal de lançamentos contendo 'ifood' na descrição/observação: {len(ifood_launches)}")
    
    ifood_counts = Counter(l.origem for l in ifood_launches)
    print("\n--- Lançamentos 'ifood' por Origem ---")
    for orig, cnt in ifood_counts.items():
        print(f"  Origem '{orig}': {cnt} lançamentos")
        
    # Mostrar os primeiros 5 lançamentos contendo 'ifood'
    print("\n--- Primeiros 5 lançamentos 'ifood' ---")
    for l in ifood_launches[:5]:
        print(f"  ID: {l.id} | Origem: {l.origem} | Valor: R$ {l.valor_previsto:.2f} | Desc: '{l.descricao}' | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()

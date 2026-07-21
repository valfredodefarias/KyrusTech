from sqlmodel import Session
from app.db.session import engine
from app.api.v1.endpoints.dre import read_dre

def run():
    session = Session(engine)
    
    # Simular a chamada da API para Empresa 35 (Umarizal), Ano 2026, Mês 1
    res = read_dre(db=session, empresa_id=35, ano=2026, mes=1)
    
    print("=== DRE API LOCAL PARA JANEIRO/2026 ===")
    print(f"Receita Total: R$ {res.receita_total:,.2f}")
    print(f"Receita Operacional: R$ {res.receita_operacional_total:,.2f}")
    print(f"Despesa Total: R$ {res.despesa_total:,.2f}")
    
    print("\n--- Categorias de Receita ---")
    for cat in sorted(res.categorias_receita, key=lambda x: x.codigo or ""):
        print(f"  Cat: {cat.codigo:<15} | Nome: {cat.nome:<30} | Total: R$ {cat.total:,.2f}")

if __name__ == "__main__":
    run()

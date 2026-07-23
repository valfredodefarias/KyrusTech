import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session
from app.db.session import engine
from app.api.v1.endpoints.dre import read_dre

def run():
    session = Session(engine)
    
    companies = {
        35: "Umarizal",
        37: "Ananindeua",
        39: "Marco Salão",
        40: "Marco Delivery"
    }
    
    for emp_id, name in companies.items():
        print(f"\n==================================================")
        print(f"DRE DA UNIDADE: {name} (ID: {emp_id})")
        print(f"==================================================")
        
        for mes in range(1, 8):
            try:
                res = read_dre(db=session, empresa_id=emp_id, ano=2026, mes=mes)
                print(f"Mês {mes:02d}/2026 -> Receita Total: R$ {res.receita_total:,.2f} | Op: R$ {res.receita_operacional_total:,.2f} | Despesa: R$ {res.despesa_total:,.2f} | Liq: R$ {res.resultado_total:,.2f}")
            except Exception as e:
                print(f"Mês {mes:02d}/2026 -> Erro ao calcular DRE: {e}")
                
    session.close()

if __name__ == "__main__":
    run()

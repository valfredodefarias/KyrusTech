from sqlmodel import Session
from app.db.session import engine
from app.api.v1.endpoints.pdv import listar_recebiveis_cartao
from datetime import date

def run():
    db = Session(engine)
    # Chama a função da API diretamente com os parâmetros para 23/07/2026
    start = date(2026, 7, 23)
    end = date(2026, 7, 23)
    
    # Para simular o usuário logado que tem empresa_id = 35
    res = listar_recebiveis_cartao(db=db, empresa_id=35, start_date=start, end_date=end)
    print(f"API returned {len(res)} items for 23/07/2026.")
    
    for idx, item in enumerate(res):
        print(f"  Item {idx+1}: ID {item['id']} | RV {item['rv']} | Brand {item['bandeira']} | Bruto {item['valor_bruto']} | Cliente {item['cliente']}")

if __name__ == "__main__":
    run()

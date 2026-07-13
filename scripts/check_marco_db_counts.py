import sys
from pathlib import Path
from sqlmodel import Session, select, func

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.pdv_venda import PdvVenda
from app.models.empresa import Empresa

COMPANY_IDS = {
    "Pizza Fabio Marco - Salao (ID 39)": 39,
    "Pizza Fabio Marco - Delivery (ID 40)": 40,
}

db = Session(engine)

for label, emp_id in COMPANY_IDS.items():
    lancamentos = db.exec(
        select(func.count()).where(
            Lancamento.empresa_id == emp_id,
            Lancamento.is_deleted == False
        )
    ).one()
    vendas = db.exec(
        select(func.count()).where(
            PdvVenda.empresa_id == emp_id,
            PdvVenda.is_deleted == False
        )
    ).one()
    print(label + ":")
    print("  Lancamentos no banco: " + str(lancamentos))
    print("  Vendas PDV no banco:  " + str(vendas))
    print()

db.close()

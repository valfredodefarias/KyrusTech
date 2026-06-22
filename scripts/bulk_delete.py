import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, text
from app.db.session import engine

with Session(engine) as db:
    print("Iniciando bulk delete...")
    res = db.exec(text("DELETE FROM lancamentos WHERE empresa_id = 27 AND observacao LIKE '%legacy_id_venda%';"))
    db.commit()
    print("Bulk delete finalizado com sucesso!")

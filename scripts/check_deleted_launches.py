from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento

db = Session(engine)

try:
    ids = [240823, 247764, 247763]
    for i in ids:
        l = db.get(Lancamento, i)
        if l:
            print(f"Lançamento ID: {l.id}")
            print(f"  Desc: {l.descricao}")
            print(f"  Tipo: {l.tipo} | Status: {l.status}")
            print(f"  Valor previsto: {l.valor_previsto} | Pago: {l.valor_pago}")
            print(f"  Vencimento: {l.data_vencimento} | Pagamento: {l.data_pagamento} | Competência: {l.data_competencia}")
            print(f"  Deleted: {l.is_deleted} | Deleted At: {l.deleted_at}")
        else:
            print(f"Lançamento ID {i} não encontrado.")
finally:
    db.close()

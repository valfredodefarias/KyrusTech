from sqlmodel import Session, select
from app.db.session import engine
from app.models.movimento_ofx import MovimentoOFX

db = Session(engine)

try:
    movs = db.exec(
        select(MovimentoOFX)
        .where(MovimentoOFX.conta_id == 228)
        .order_by(MovimentoOFX.data.desc())
        .limit(20)
    ).all()
    
    print("Latest 20 Movimentos OFX:")
    for m in movs:
        print(f"- ID #{m.id} | Desc: {m.descricao} | Date: {m.data} | Valor: {m.valor} | Status: {m.status} | Import Hash: {m.import_hash}")
finally:
    db.close()

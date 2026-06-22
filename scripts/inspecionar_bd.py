from sqlmodel import Session, select, func
from app.db.session import engine
from app.models.lancamento import Lancamento

with Session(engine) as db:
    total_lancamentos = db.exec(
        select(func.count(Lancamento.id))
        .where(
            Lancamento.empresa_id == 27,
            Lancamento.is_deleted == False
        )
    ).one()
    
    pdv_vendas = db.exec(
        select(func.count(Lancamento.id))
        .where(
            Lancamento.empresa_id == 27,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV"
        )
    ).one()
    
    print(f"Total de lançamentos ativos para a Empresa 27: {total_lancamentos}")
    print(f"Lançamentos com origem PDV (vendas): {pdv_vendas}")

import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade

def run():
    session = Session(engine)
    
    # 1. Obter ou criar "Recebimento Cartões" para empresa 35
    entidade = session.exec(
        select(Entidade)
        .where(
            Entidade.empresa_id == 35,
            Entidade.nome == "Recebimento Cartões"
        )
    ).first()
    
    if not entidade:
        entidade = Entidade(
            nome="Recebimento Cartões",
            empresa_id=35,
            tipo="AMBOS",
            tipo_pessoa="PJ",
            status="ATIVO"
        )
        session.add(entidade)
        session.flush()
        
    # 2. Obter lançamentos agrupados de hoje
    lances = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.data_vencimento == '2026-07-21',
            Lancamento.is_deleted == False
        )
    ).all()
    
    updated_count = 0
    for l in lances:
        is_grouped = False
        if l.observacao:
            try:
                is_grouped = json.loads(l.observacao).get("grouped_card_launch", False)
            except:
                pass
        if is_grouped or l.descricao in ["Visa Debito", "Master Debito", "Elo Debito"]:
            l.entidade_id = entidade.id
            session.add(l)
            updated_count += 1
            
    session.commit()
    print(f"Sucesso! {updated_count} lançamentos agrupados foram atualizados com a entidade Recebimento Cartões (ID: {entidade.id}).")

if __name__ == "__main__":
    run()

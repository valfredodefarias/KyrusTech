from sqlmodel import Session, select
from app.db.session import engine
from app.models.entidade import Entidade

def clean_nbsp():
    with Session(engine) as session:
        # Busca todas as entidades cujo nome contém '&nbsp;'
        entities = session.exec(select(Entidade).where(Entidade.nome.like("%&nbsp;%"))).all()
        print(f"Encontrados {len(entities)} interessados com &nbsp; no nome.")
        
        for entity in entities:
            old_nome = entity.nome
            new_nome = old_nome.replace("&nbsp;", " ").strip()
            # Remove múltiplos espaços extras se houver
            while "  " in new_nome:
                new_nome = new_nome.replace("  ", " ")
            entity.nome = new_nome
            session.add(entity)
            print(f"Atualizando ID {entity.id}: '{old_nome}' -> '{new_nome}'")
            
        session.commit()
        print("Remoção de &nbsp; concluída com sucesso no banco de dados!")

if __name__ == "__main__":
    clean_nbsp()

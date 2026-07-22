from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento

def run(dry_run=True):
    session = Session(engine)
    
    # Buscar lançamentos ativos que tenham o prefixo de duplicado deletado
    query = select(Lancamento).where(
        Lancamento.is_deleted == False,
        Lancamento.descricao.like("[DUPLICADO DELETADO]%")
    )
    
    launches = session.exec(query).all()
    print(f"Encontrados {len(launches)} lançamentos ativos com prefixo '[DUPLICADO DELETADO]' na descrição.")
    
    if dry_run:
        print("--- MODO SIMULAÇÃO (Sem alterações no banco de dados) ---")
    else:
        print("--- EXECUTANDO LIMPEZA REAL ---")
        
    count = 0
    for l in launches:
        old_desc = l.descricao
        # Remove "[DUPLICADO DELETADO] " ou "[DUPLICADO DELETADO]"
        if old_desc.startswith("[DUPLICADO DELETADO] "):
            new_desc = old_desc[len("[DUPLICADO DELETADO] "):]
        elif old_desc.startswith("[DUPLICADO DELETADO]"):
            new_desc = old_desc[len("[DUPLICADO DELETADO]"):]
        else:
            continue
            
        # Também limpa a observação
        old_obs = l.observacao or ""
        new_obs = old_obs
        prefix_obs = "[DUPLICADO DELETADO EM LIMPEZA EM MASSA] "
        if old_obs.startswith(prefix_obs):
            new_obs = old_obs[len(prefix_obs):]
        elif old_obs.startswith("[DUPLICADO DELETADO EM LIMPEZA EM MASSA]"):
            new_obs = old_obs[len("[DUPLICADO DELETADO EM LIMPEZA EM MASSA]"):]
            
        print(f"  ID {l.id:<7} | '{old_desc}' -> '{new_desc}'")
        
        if not dry_run:
            l.descricao = new_desc
            l.observacao = new_obs
            session.add(l)
            count += 1
            if count % 1000 == 0:
                session.commit()
                
    if not dry_run:
        session.commit()
        print(f"\n✅ Descrições de {count} lançamentos limpas com sucesso!")
    else:
        print("\nSimulação concluída. Rode com o argumento 'run' para aplicar.")

if __name__ == "__main__":
    import sys
    dry_run = True
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        dry_run = False
    run(dry_run)

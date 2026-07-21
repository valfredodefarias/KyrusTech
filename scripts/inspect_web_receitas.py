from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from collections import Counter

def run():
    session = Session(engine)
    
    # Obter todas as categorias
    categorias = session.exec(select(PlanoContas)).all()
    categoria_by_id = {c.id: f"{c.codigo} - {c.nome}" for c in categorias}
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n==================================================")
        print(f"EMPRESA ID: {emp_id}")
        print(f"==================================================")
        
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.tipo == "RECEITA",
                Lancamento.origem == "WEB",
                Lancamento.is_deleted == False
            )
        ).all()
        
        print(f"Total de receitas WEB ativas: {len(launches)}")
        
        # Agrupar por categoria
        cat_counts = Counter(l.plano_contas_id for l in launches)
        print("\n--- Receitas por Categoria ---")
        for cid, cnt in cat_counts.most_common():
            cname = categoria_by_id.get(cid, f"Desconhecida (ID: {cid})")
            print(f"  {cname}: {cnt} lançamentos")
            
        # Listar exemplos de descrições mais comuns
        desc_counts = Counter(l.descricao for l in launches)
        print("\n--- Top 15 Descrições ---")
        for desc, cnt in desc_counts.most_common(15):
            print(f"  '{desc}': {cnt} lançamentos")

if __name__ == "__main__":
    run()

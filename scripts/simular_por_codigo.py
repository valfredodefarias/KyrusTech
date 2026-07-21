from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas

def run():
    session = Session(engine)
    
    # Mapear códigos por empresa
    DUPLICATE_CODES_BY_EMP = {
        35: {'01.01.01', '01.01.02', '01.01.03', '01.01.04', '01.01.05'},
        37: {'01.01', '01.02', '01.03', '01.04', '01.05'},
        39: {'01.01', '01.02', '01.03', '01.04', '01.05'},
        40: {'01.01.01', '01.01.02', '01.01.03', '01.01.04', '01.01.05'}
    }
    
    # Obter todas as categorias
    categorias = session.exec(select(PlanoContas)).all()
    categoria_by_id = {c.id: c for c in categorias}
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n==================================================")
        print(f"SIMULAÇÃO POR CÓDIGO EMPRESA ID: {emp_id}")
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
        
        to_delete = []
        to_keep = []
        
        dup_codes = DUPLICATE_CODES_BY_EMP[emp_id]
        
        for l in launches:
            cat = categoria_by_id.get(l.plano_contas_id)
            if not cat:
                to_keep.append(l)
                continue
                
            obs = (l.observacao or "").lower()
            is_legacy = "importação financeiro" in obs or "importacao financeiro" in obs
            
            if is_legacy and cat.codigo in dup_codes:
                to_delete.append(l)
            else:
                to_keep.append(l)
                
        val_delete = sum(l.valor_previsto for l in to_delete)
        val_keep = sum(l.valor_previsto for l in to_keep)
        
        print(f"-> Para DELETAR: {len(to_delete)} lançamentos (Valor: R$ {val_delete:,.2f})")
        print(f"-> Para MANTER: {len(to_keep)} lançamentos (Valor: R$ {val_keep:,.2f})")
        
        print("\n--- Primeiros 10 a serem DELETADOS ---")
        for l in to_delete[:10]:
            cat = categoria_by_id.get(l.plano_contas_id)
            print(f"  ID: {l.id} | Code: {cat.codigo} | Desc: '{l.descricao}' | Obs: '{l.observacao}' | Valor: R$ {l.valor_previsto:.2f}")

if __name__ == "__main__":
    run()

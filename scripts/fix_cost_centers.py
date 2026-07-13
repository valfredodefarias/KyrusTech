# scripts/fix_cost_centers.py
import sys
from pathlib import Path
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.centro_custo import CentroCusto
from app.models.empresa import Empresa

def fix_cost_centers():
    print("=== INICIANDO AJUSTE DOS LANÇAMENTOS SEM CENTRO DE CUSTO ===")
    db = Session(engine)
    try:
        # Get all companies
        companies = db.exec(select(Empresa)).all()
        company_cc_map = {}
        
        # Build map of empresa_id -> default centro_custo_id
        for comp in companies:
            cc = db.exec(
                select(CentroCusto)
                .where(CentroCusto.empresa_id == comp.id)
                .order_by(CentroCusto.id.asc())
            ).first()
            if cc:
                company_cc_map[comp.id] = cc.id
                print(f"Empresa '{comp.nome_fantasia}' (ID: {comp.id}) -> Centro de Custo Padrão: '{cc.nome}' (ID: {cc.id})")
            else:
                print(f"[AVISO] Empresa '{comp.nome_fantasia}' não possui centro de custo cadastrado!")

        # Find all transactions where centro_custo_id is null or 0
        txs = db.exec(
            select(Lancamento)
            .where(
                (Lancamento.centro_custo_id == None) | 
                (Lancamento.centro_custo_id == 0)
            )
        ).all()
        
        print(f"\nTotal de lançamentos encontrados sem Centro de Custo: {len(txs)}")
        
        updated_count = 0
        skipped_count = 0
        
        for tx in txs:
            default_cc_id = company_cc_map.get(tx.empresa_id)
            if default_cc_id:
                tx.centro_custo_id = default_cc_id
                db.add(tx)
                updated_count += 1
            else:
                skipped_count += 1
                
        db.commit()
        print(f"\nAjuste concluído! Lançamentos atualizados: {updated_count} | Lançamentos pulados: {skipped_count}")
        
    except Exception as e:
        print(f"[ERRO] Falha ao ajustar centros de custo: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    fix_cost_centers()

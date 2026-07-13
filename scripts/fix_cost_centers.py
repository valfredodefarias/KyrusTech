# scripts/fix_cost_centers.py
import sys
from pathlib import Path
from sqlmodel import Session, select, text

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.centro_custo import CentroCusto
from app.models.empresa import Empresa

def fix_cost_centers():
    print("=== INICIANDO AJUSTE DOS CENTROS DE CUSTO - APENAS PIZZARIAS ===")
    db = Session(engine)
    try:
        # Get only Pizza Fábio companies
        companies = db.exec(
            select(Empresa)
            .where(
                Empresa.nome_fantasia.like("%Pizza Fábio%") | 
                Empresa.nome_fantasia.like("%Pizza Fabio%")
            )
        ).all()
        
        # Execute updates per company in bulk using raw SQL for maximum performance
        total_updated = 0
        for comp in companies:
            # Find default Cost Center ID
            cc = db.exec(
                select(CentroCusto)
                .where(CentroCusto.empresa_id == comp.id)
                .order_by(CentroCusto.id.asc())
            ).first()
            
            if cc:
                # Direct SQL Bulk Update (Executes in milliseconds in the DB)
                result = db.execute(
                    text("""
                        UPDATE lancamentos 
                        SET centro_custo_id = :cc_id 
                        WHERE empresa_id = :emp_id 
                          AND (centro_custo_id IS NULL OR centro_custo_id = 0)
                    """),
                    {"cc_id": cc.id, "emp_id": comp.id}
                )
                db.commit()
                rowcount = result.rowcount
                total_updated += rowcount
                print(f"  - Empresa '{comp.nome_fantasia}' (ID: {comp.id}): Atualizados {rowcount} lançamentos.")
            else:
                print(f"  - [AVISO] Empresa '{comp.nome_fantasia}' não possui centro de custo cadastrado.")
                
        print(f"\n[OK] Ajuste concluído! Lançamentos de pizzarias atualizados: {total_updated}")
        
    except Exception as e:
        print(f"[ERRO] Falha ao ajustar centros de custo: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    fix_cost_centers()

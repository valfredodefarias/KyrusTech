# scripts/inspect_dre_dup.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, select, or_, func, text
from decimal import Decimal
from datetime import date

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings
from app.models.lancamento import Lancamento
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.plano_contas import PlanoContas

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    # We will inspect Pizza Fábio Umarizal (ID 35)
    with engine.connect() as conn:
        res = conn.execute(text("SELECT id, nome_fantasia FROM empresas WHERE id = 35 OR nome_fantasia ILIKE '%Umarizal%'"))
        empresas = res.all()
        print("Empresas encontradas:", empresas)
        if not empresas:
            print("Nenhuma empresa encontrada.")
            return
        
        for emp in empresas:
            empresa_id = emp[0]
            empresa_nome = emp[1]
            print(f"\n=======================================================")
            print(f"Analisando DRE de: {empresa_nome} (ID: {empresa_id})")
            print(f"=======================================================")
            
            # Max web date
            max_web_res = conn.execute(text(
                "SELECT max(data_vencimento) FROM lancamentos WHERE empresa_id = :empresa_id AND origem = 'WEB' AND is_deleted = false"
            ), {"empresa_id": empresa_id})
            max_web_date = max_web_res.scalar()
            print("max_web_date (origem='WEB'):", max_web_date)
            
            for m in range(1, 8):
                start_date = f"2026-{m:02d}-01"
                end_date = f"2026-{m:02d}-31" if m in [1, 3, 5, 7] else (f"2026-{m:02d}-30" if m != 2 else "2026-02-28")
                
                # Query Lancamentos
                lan_query = conn.execute(text("""
                    SELECT l.origem, SUM(COALESCE(NULLIF(l.valor_pago, 0), l.valor_previsto))
                    FROM lancamentos l
                    JOIN plano_contas pc ON pc.id = l.plano_contas_id
                    WHERE l.empresa_id = :empresa_id
                      AND l.is_deleted = false
                      AND pc.tipo = 'R'
                      AND COALESCE(l.data_competencia, l.data_vencimento) >= :start_date
                      AND COALESCE(l.data_competencia, l.data_vencimento) <= :end_date
                      AND (l.observacao IS NULL OR (l.observacao NOT ILIKE '%DestinoCompra DEMONSTRACAO%' AND l.observacao NOT ILIKE '%"legacy_id_venda"%'))
                      AND (l.import_hash IS NULL OR l.import_hash NOT ILIKE 'sangria-%')
                    GROUP BY l.origem
                """), {"empresa_id": empresa_id, "start_date": start_date, "end_date": end_date}).all()
                
                # Query PdvMovimentacoes
                mov_query = conn.execute(text("""
                    SELECT SUM(pm.valor)
                    FROM pdv_movimentacoes pm
                    WHERE pm.empresa_id = :empresa_id
                      AND pm.is_deleted = false
                      AND pm.tipo = 'ENTRADA'
                      AND pm.forma_pagamento IN ('DEBITO', 'CREDITO_AVISTA', 'CREDITO_PARCELADO')
                      AND pm.data >= :start_date
                      AND pm.data <= :end_date
                      AND pm.data > COALESCE(:max_web_date, '2000-01-01'::date)
                """), {"empresa_id": empresa_id, "start_date": start_date, "end_date": end_date, "max_web_date": max_web_date}).scalar() or Decimal("0.00")
                
                lan_dict = {r[0]: Decimal(str(r[1] or 0)) for r in lan_query}
                total_mes = sum(lan_dict.values()) + mov_query
                print(f"Mês 2026-{m:02d} | TOTAL DRE: {total_mes:12.2f} | Lancamentos WEB: {lan_dict.get('WEB', 0):12.2f} | Lancamentos PDV: {lan_dict.get('PDV', 0):12.2f} | PdvMovs (>max_web): {mov_query:12.2f}")


if __name__ == "__main__":
    main()

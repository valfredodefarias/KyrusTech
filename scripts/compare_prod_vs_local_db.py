# scripts/compare_prod_vs_local_db.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from datetime import datetime, date
from decimal import Decimal

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        print("======================================================================")
        print("AUDITORIA E COMPARATIVO DE BANCO DE DADOS (PRODUÇÃO)")
        print("======================================================================")
        
        # 1. Total launches created today (2026-07-27)
        today_str = date.today().strftime("%Y-%m-%d")
        today_launches = conn.execute(text("""
            SELECT COUNT(*), SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
            FROM lancamentos
            WHERE DATE(created_at) = CURRENT_DATE
        """)).first()
        
        print(f"\n📌 LANÇAMENTOS CRIADOS HOJE ({today_str}):")
        print(f"  - Total de registros criados hoje: {today_launches[0]}")
        print(f"  - Valor acumulado: R$ {Decimal(str(today_launches[1] or 0)):12.2f}")
        print("  ⚠️ ESTES REGISTROS SERÃO 100% PRESERVADOS E INTOCADOS.")
        
        # 2. Check accounts initial balances vs calculated balances
        print("\n📌 CONCILIAÇÃO DE CONTAS BANCÁRIAS E CAIXAS:")
        contas = conn.execute(text("""
            SELECT c.id, e.nome_fantasia, c.nome, c.saldo_inicial
            FROM contas c
            JOIN empresas e ON e.id = c.empresa_id
            WHERE c.empresa_id IN (35, 37, 39, 40)
              AND c.is_deleted = false
            ORDER BY c.empresa_id, c.id
        """)).all()
        
        target_account_balances = {
            # Pizza Fábio Marco - Salão (39)
            328: ("PDV Salão", Decimal("8716.55"), 39),
            329: ("Tesouraria Marco", Decimal("1266.99"), 39),
            330: ("Itaú Marco", Decimal("43402.37"), 39),
            
            # Pizza Fábio Ananindeua (37)
            320: ("Itaú Ananindeua", Decimal("20783.83"), 37),
            321: ("Tesouraria Ananindeua", Decimal("2189.56"), 37),
            322: ("Itaú Ananindeua - Aplicação", Decimal("0.00"), 37),
            323: ("PDV Ananindeua", Decimal("1578.24"), 37),
        }
        
        for c in contas:
            cid = c[0]
            emp_nome = c[1]
            c_nome = c[2]
            s_ini = Decimal(str(c[3] or 0))
            
            if cid in target_account_balances:
                _, target_bal, emp_id = target_account_balances[cid]
                # Calculate API movement net
                row = conn.execute(text("""
                    SELECT 
                        COALESCE(SUM(CASE WHEN UPPER(tipo) LIKE 'R%' THEN valor_pago ELSE 0 END), 0) AS receitas,
                        COALESCE(SUM(CASE WHEN UPPER(tipo) LIKE 'D%' THEN valor_pago ELSE 0 END), 0) AS despesas
                    FROM lancamentos
                    WHERE empresa_id = :empresa_id
                      AND conta_id = :conta_id
                      AND is_deleted = false
                      AND (status = 'PAGO' OR data_pagamento IS NOT NULL)
                      AND (observacao IS NULL OR (
                          observacao NOT ILIKE '%DestinoCompra DEMONSTRACAO%' 
                          AND observacao NOT ILIKE '%"legacy_id_venda"%'
                      ))
                """), {"empresa_id": emp_id, "conta_id": cid}).first()
                
                mov_net = Decimal(str(row[0] or 0)) - Decimal(str(row[1] or 0)) if row else Decimal("0.00")
                calc_saldo = s_ini + mov_net
                diff = target_bal - calc_saldo
                print(f"  Conta [{emp_nome}] '{c_nome}' (ID {cid}): Atual = R$ {calc_saldo:10.2f} | Alvo = R$ {target_bal:10.2f} | Dif: R$ {diff:10.2f}")

if __name__ == "__main__":
    main()

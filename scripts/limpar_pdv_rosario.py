import os
import sys
from sqlalchemy import create_engine, text

def main():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        db_url = "postgresql://kyrus_user:kyrus_pass@db_kyrustech:5432/kyrus_erp"
    
    print("=" * 80)
    print("🧹 EXECUTANDO LIMPEZA DE LANÇAMENTOS DO PDV - ROSÁRIO BELÉM (EMPRESA 27)")
    print("=" * 80)

    engine = create_engine(db_url)
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            # 1. Contar lançamentos ativos do PDV antes
            qtd_antes = conn.execute(text("""
                SELECT COUNT(id) FROM lancamentos WHERE empresa_id = 27 AND origem = 'PDV' AND is_deleted = false
            """)).scalar()
            
            print(f"📊 Lançamentos do PDV ativos no momento: {qtd_antes} registros")

            if qtd_antes == 0:
                print("✅ Nenhum lançamento ativo do PDV encontrado. A base já está limpa!")
                trans.rollback()
                return

            # 2. Executar soft-delete (is_deleted = true)
            res = conn.execute(text("""
                UPDATE lancamentos 
                SET is_deleted = true, updated_at = NOW()
                WHERE empresa_id = 27 AND origem = 'PDV' AND is_deleted = false
            """))

            print(f"✔️ {res.rowcount} lançamentos do PDV foram marcados como excluídos (is_deleted = true).")

            # 3. Recalcular saldo da conta DINHEIRO (ID 210)
            saldo_dinheiro = conn.execute(text("""
                SELECT 
                    c.saldo_inicial + 
                    COALESCE(SUM(CASE WHEN UPPER(l.tipo) LIKE 'R%' THEN l.valor_pago ELSE 0 END), 0) - 
                    COALESCE(SUM(CASE WHEN UPPER(l.tipo) LIKE 'D%' THEN l.valor_pago ELSE 0 END), 0) as saldo_atual
                FROM contas c
                LEFT JOIN lancamentos l ON l.conta_id = c.id AND l.is_deleted = false AND (l.status = 'PAGO' OR l.data_pagamento IS NOT NULL)
                WHERE c.id = 210
                GROUP BY c.id, c.saldo_inicial
            """)).scalar()

            print(f"💵 Novo saldo atual da Conta DINHEIRO (ID 210): R$ {saldo_dinheiro:,.2f}")

            trans.commit()
            print("\n🎉 Limpeza concluída com sucesso!")

        except Exception as e:
            trans.rollback()
            print(f"\n❌ Erro durante a limpeza: {e}")
            sys.exit(1)

if __name__ == "__main__":
    main()

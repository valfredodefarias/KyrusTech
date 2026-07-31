"""
Script Sniper de Reversão da Conciliação de Hoje (31/07/2026) para a Conta 215 (ITAÚ - RMUSIC)
Preserva o Saldo Inicial das 08:16 (R$ 3.457,50) e restabelece a diferença histórica de R$ 176,80 na tela de OFX.
"""
import os
os.environ["DISABLE_AUDIT"] = "1"

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine
from app.api.v1.endpoints.importacao_ofx import _calcular_saldo_atual_conta

CONTA_ID = 215
EMPRESA_ID = 27

def reverter_conciliacao_hoje():
    print("🎯 INICIANDO REVERSÃO DA CONCILIAÇÃO DE HOJE - CONTA 215 (ITAÚ - RMUSIC)")

    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = '300s';"))

        # 1. Manter Saldo Inicial em R$ 3.457,50 (Ajuste das 08:16 da manhã)
        conn.execute(text("""
            UPDATE contas
            SET saldo_inicial = 3457.50
            WHERE id = :cid
        """), {'cid': CONTA_ID})
        print("  ✅ Saldo Inicial mantido em R$ 3.457,50.")

        # 2. Desativar lançamentos criados HOJE durante as tentativas de conciliação
        conn.execute(text("""
            UPDATE lancamentos
            SET is_deleted = true, deleted_at = NOW()
            WHERE conta_id = :cid AND created_at >= '2026-07-31 00:00:00'
        """), {'cid': CONTA_ID})

        # 3. Desativar baixas criadas HOJE
        conn.execute(text("""
            UPDATE baixas
            SET is_deleted = true, deleted_at = NOW()
            WHERE (created_at >= '2026-07-31 00:00:00' OR lancamento_id IN (
                SELECT id FROM lancamentos WHERE conta_id = :cid AND is_deleted = true
            ))
            AND lancamento_id IN (
                SELECT id FROM lancamentos WHERE conta_id = :cid
            )
        """), {'cid': CONTA_ID})
        print("  ✅ Lançamentos e baixas criados hoje foram desativados.")

        # 4. Sincronizar lançamentos antigos com as baixas de datas anteriores a hoje
        conn.execute(text("""
            WITH baixas_agg AS (
                SELECT 
                    b.lancamento_id,
                    SUM(b.valor_pago) as principal,
                    MAX(b.data_baixa) as max_data_baixa,
                    COUNT(b.id) as total_baixas
                FROM baixas b
                JOIN lancamentos l ON l.id = b.lancamento_id
                WHERE b.is_deleted = false AND l.conta_id = :cid AND b.created_at < '2026-07-31 00:00:00'
                GROUP BY b.lancamento_id
            )
            UPDATE lancamentos
            SET 
                valor_pago = COALESCE(ba.principal, 0.00),
                data_pagamento = ba.max_data_baixa,
                conciliado = CASE WHEN ba.total_baixas > 0 THEN true ELSE false END,
                status = CASE 
                    WHEN ba.total_baixas > 0 AND (lancamentos.valor_previsto - ba.principal) <= 0.01 THEN 'PAGO'
                    WHEN ba.total_baixas > 0 THEN 'PARCIAL'
                    ELSE 'EM ABERTO'
                END
            FROM baixas_agg ba
            WHERE lancamentos.id = ba.lancamento_id
              AND lancamentos.empresa_id = :eid AND lancamentos.conta_id = :cid AND lancamentos.is_deleted = false
        """), {'eid': EMPRESA_ID, 'cid': CONTA_ID})

        # Resetar status de lançamentos sem baixas anteriores a hoje
        conn.execute(text("""
            UPDATE lancamentos
            SET valor_pago = 0.00, valor_juros = 0.00, valor_multa = 0.00, valor_desconto = 0.00,
                data_pagamento = NULL, conciliado = false, status = 'EM ABERTO'
            WHERE empresa_id = :eid AND conta_id = :cid AND is_deleted = false
              AND id NOT IN (
                  SELECT b.lancamento_id 
                  FROM baixas b 
                  JOIN lancamentos l ON l.id = b.lancamento_id
                  WHERE b.is_deleted = false AND l.empresa_id = :eid AND l.conta_id = :cid
                    AND b.created_at < '2026-07-31 00:00:00'
              )
        """), {'eid': EMPRESA_ID, 'cid': CONTA_ID})

        # 5. Reabrir movimentações OFX do dia 30/07 para a Conta 215
        conn.execute(text("""
            UPDATE movimentos
            SET status = 'ABERTO'
            WHERE conta_id = :cid AND data >= '2026-07-30'
        """), {'cid': CONTA_ID})

        # 6. Marcar audit logs de hoje para a Conta 215 como undone
        conn.execute(text("""
            UPDATE audit_logs
            SET undone = true
            WHERE created_at >= '2026-07-31 00:00:00'
              AND (
                  (table_name = 'lancamentos' AND record_id IN (SELECT id FROM lancamentos WHERE conta_id = :cid)) OR
                  (table_name = 'baixas' AND record_id IN (SELECT b.id FROM baixas b JOIN lancamentos l ON l.id = b.lancamento_id WHERE l.conta_id = :cid))
              )
        """), {'cid': CONTA_ID})

        conn.commit()
        print("  ✅ Reversão concluída com sucesso!")

if __name__ == '__main__':
    reverter_conciliacao_hoje()

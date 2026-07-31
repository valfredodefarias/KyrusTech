"""
Script para desfazer todas as conciliações e baixas realizadas nos últimos 3 dias (29/07 a 31/07)
exclusivamente para a Conta 215 (ITAÚ - RMUSIC).
"""
import os
os.environ["DISABLE_AUDIT"] = "1"

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine
from app.api.v1.endpoints.importacao_ofx import _calcular_saldo_atual_conta

CONTA_ID = 215
EMPRESA_ID = 27

def desfazer_conciliacoes_ultimos_3_dias():
    print("🎯 INICIANDO REVERSÃO DE TODAS AS CONCILIAÇÕES DOS ÚLTIMOS 3 DIAS (29/07 A 31/07) - CONTA 215")

    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = '300s';"))

        # 1. Desativar todas as baixas com data_baixa ou created_at a partir de 29/07/2026 para a Conta 215
        res_baixas = conn.execute(text("""
            UPDATE baixas
            SET is_deleted = true, deleted_at = NOW()
            WHERE (data_baixa >= '2026-07-29' OR created_at >= '2026-07-29 00:00:00')
              AND lancamento_id IN (
                  SELECT id FROM lancamentos WHERE conta_id = :cid
              )
        """), {'cid': CONTA_ID})
        print("  ✅ Baixas realizadas nos últimos 3 dias desativadas.")

        # 2. Desativar lançamentos automáticos de ajuste criados nos últimos 3 dias para a Conta 215
        conn.execute(text("""
            UPDATE lancamentos
            SET is_deleted = true, deleted_at = NOW()
            WHERE conta_id = :cid AND created_at >= '2026-07-29 00:00:00'
              AND (descricao ILIKE 'Ajuste%' OR descricao ILIKE '%juros%')
        """), {'cid': CONTA_ID})
        print("  ✅ Lançamentos de ajuste criados nos últimos 3 dias desativados.")

        # 3. Resetar status e pagamento de lançamentos da Conta 215 com pagamentos a partir de 29/07
        conn.execute(text("""
            UPDATE lancamentos
            SET valor_pago = 0.00, valor_juros = 0.00, valor_multa = 0.00, valor_desconto = 0.00,
                data_pagamento = NULL, conciliado = false, status = 'EM ABERTO'
            WHERE empresa_id = :eid AND conta_id = :cid AND is_deleted = false
              AND (data_pagamento >= '2026-07-29' OR id NOT IN (
                  SELECT b.lancamento_id
                  FROM baixas b
                  JOIN lancamentos l ON l.id = b.lancamento_id
                  WHERE b.is_deleted = false AND l.empresa_id = :eid AND l.conta_id = :cid
              ))
        """), {'eid': EMPRESA_ID, 'cid': CONTA_ID})
        print("  ✅ Lançamentos com pagamentos dos últimos 3 dias voltaram para o status EM ABERTO.")

        # 4. Reabrir todas as movimentações OFX do extrato a partir do dia 29/07 para a Conta 215
        conn.execute(text("""
            UPDATE movimentos
            SET status = 'ABERTO'
            WHERE conta_id = :cid AND data >= '2026-07-29'
        """), {'cid': CONTA_ID})
        print("  ✅ Movimentações OFX do extrato (29/07 em diante) reabertas para status ABERTO.")

        # 5. Marcar audit logs dos últimos 3 dias para a Conta 215 como desfeitos
        conn.execute(text("""
            UPDATE audit_logs
            SET undone = true
            WHERE created_at >= '2026-07-29 00:00:00'
              AND (
                  (table_name = 'lancamentos' AND record_id IN (SELECT id FROM lancamentos WHERE conta_id = :cid)) OR
                  (table_name = 'baixas' AND record_id IN (SELECT b.id FROM baixas b JOIN lancamentos l ON l.id = b.lancamento_id WHERE l.conta_id = :cid))
              )
        """), {'cid': CONTA_ID})
        print("  ✅ Audit logs dos últimos 3 dias da Conta 215 marcados como desfeitos.")

        conn.commit()

    print("\n✅ TODAS AS CONCILIAÇÕES DOS ÚLTIMOS 3 DIAS FORAM DESFEITAS COM SUCESSO!")

if __name__ == '__main__':
    desfazer_conciliacoes_ultimos_3_dias()

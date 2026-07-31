"""
Script para desfazer 100% de qualquer operacao/conciliacao realizada HOJE (31/07/2026) na conta ITAÚ - RMUSIC (ID 215, Empresa 27).
Otimizacao de performance por conta especifica (Instantaneo).
"""
import os
import sys
from decimal import Decimal
from sqlmodel import Session
from sqlalchemy import text

from app.db.session import engine
from app.models.conta import Conta

def desfazer_operacoes_hoje():
    with Session(engine) as db:
        print("=== CANCELANDO/DESFAZENDO TODAS AS OPERAÇÕES DE HOJE (31/07/2026) NA CONTA ITAÚ - RMUSIC ===")

        # Desativar statement_timeout para esta sessao caso necessario
        db.exec(text("SET statement_timeout = '60s';"))

        # 1. Soft-delete em TODAS as baixas criadas ou modificadas hoje (31/07/2026) para a conta 215
        db.exec(text("""
            UPDATE baixas 
            SET is_deleted = true 
            WHERE id IN (
                SELECT b.id 
                FROM baixas b
                JOIN lancamentos l ON l.id = b.lancamento_id
                WHERE l.empresa_id = 27 AND l.conta_id = 215 
                  AND (b.created_at::date = '2026-07-31' OR b.updated_at::date = '2026-07-31' OR b.data_baixa = '2026-07-31' OR l.id >= 1056000)
            )
        """))
        db.commit()
        print("1. Baixas de hoje canceladas com sucesso.")

        # 2. Deletar (is_deleted = true) novos lancamentos criados hoje durante a importacao OFX (id >= 1056000 ou origem OFX)
        db.exec(text("""
            UPDATE lancamentos
            SET is_deleted = true, status = 'EM ABERTO', valor_pago = 0.00, data_pagamento = NULL, conciliado = false
            WHERE empresa_id = 27 AND conta_id = 215 
              AND (id >= 1056000 OR (origem = 'OFX' AND created_at::date = '2026-07-31'))
        """))
        db.commit()
        print("2. Novos lançamentos criados pela importação de hoje foram desativados.")

        # 3. Recalcular os lancamentos da conta 215 baseando-se APENAS nas suas baixas ativas
        db.exec(text("""
            WITH baixas_conta AS (
                SELECT 
                    b.lancamento_id,
                    SUM(CASE WHEN b.tipo_baixa = 'PRINCIPAL' THEN b.valor_pago ELSE 0 END) AS principal,
                    SUM(CASE WHEN b.tipo_baixa = 'JUROS' THEN b.valor_pago ELSE 0 END) AS juros,
                    SUM(CASE WHEN b.tipo_baixa = 'MULTA' THEN b.valor_pago ELSE 0 END) AS multa,
                    SUM(CASE WHEN b.tipo_baixa = 'DESCONTO' THEN b.valor_pago ELSE 0 END) AS desconto,
                    MAX(b.data_baixa) AS max_data_baixa,
                    COUNT(b.id) AS total_baixas
                FROM baixas b
                JOIN lancamentos l ON l.id = b.lancamento_id
                WHERE l.empresa_id = 27 AND l.conta_id = 215 AND b.is_deleted = false
                GROUP BY b.lancamento_id
            )
            UPDATE lancamentos
            SET 
                valor_pago = COALESCE(bc.principal + bc.juros + bc.multa - bc.desconto, 0.00),
                valor_juros = COALESCE(bc.juros, 0.00),
                valor_multa = COALESCE(bc.multa, 0.00),
                valor_desconto = COALESCE(bc.desconto, 0.00),
                data_pagamento = bc.max_data_baixa,
                conciliado = CASE WHEN bc.total_baixas > 0 THEN true ELSE false END,
                status = CASE 
                    WHEN bc.total_baixas > 0 AND (lancamentos.valor_previsto - (bc.principal + bc.desconto)) <= 0.01 THEN 'PAGO'
                    WHEN bc.total_baixas > 0 THEN 'PARCIAL'
                    ELSE 'EM ABERTO'
                END
            FROM baixas_conta bc
            WHERE lancamentos.id = bc.lancamento_id
              AND lancamentos.empresa_id = 27 AND lancamentos.conta_id = 215 AND lancamentos.is_deleted = false
        """))

        # Zerar lancamentos da conta 215 que nao tem NENHUMA baixa ativa
        db.exec(text("""
            UPDATE lancamentos
            SET valor_pago = 0.00, valor_juros = 0.00, valor_multa = 0.00, valor_desconto = 0.00,
                data_pagamento = NULL, conciliado = false, status = 'EM ABERTO'
            WHERE empresa_id = 27 AND conta_id = 215 AND is_deleted = false
              AND id NOT IN (
                  SELECT b.lancamento_id 
                  FROM baixas b
                  JOIN lancamentos l ON l.id = b.lancamento_id
                  WHERE l.empresa_id = 27 AND l.conta_id = 215 AND b.is_deleted = false
              )
        """))
        db.commit()
        print("3. Títulos pré-existentes recalculados com base única em baixas ativas anteriores.")

        # 4. Reabrir a fila de movimentos bancarios OFX da conta
        db.exec(text("""
            UPDATE movimentos
            SET status = 'ABERTO'
            WHERE empresa_id = 27 AND conta_id = 215 AND status != 'ABERTO'
        """))
        db.commit()
        print("4. Fila de movimentos OFX reaberta com sucesso.")

        # 5. Saldo final recalculado
        conta = db.get(Conta, 215)
        saldo_inicial = Decimal(str(conta.saldo_inicial))

        rec_pagas = Decimal(str(db.exec(text("SELECT COALESCE(SUM(valor_pago), 0) FROM lancamentos WHERE empresa_id = 27 AND conta_id = 215 AND is_deleted = false AND (status = 'PAGO' OR data_pagamento IS NOT NULL) AND UPPER(tipo) LIKE 'R%'")).scalar()))
        desp_pagas = Decimal(str(db.exec(text("SELECT COALESCE(SUM(valor_pago), 0) FROM lancamentos WHERE empresa_id = 27 AND conta_id = 215 AND is_deleted = false AND (status = 'PAGO' OR data_pagamento IS NOT NULL) AND UPPER(tipo) LIKE 'D%'")).scalar()))

        saldo_final = saldo_inicial + rec_pagas - desp_pagas

        print("\n==================================================================")
        print(f"CONTA: {conta.nome}")
        print(f"SALDO INICIAL: R$ {saldo_inicial:.2f}")
        print(f"RECEITAS PAGAS: R$ {rec_pagas:.2f}")
        print(f"DESPESAS PAGAS: R$ {desp_pagas:.2f}")
        print(f"SALDO RESULTANTE APÓS REVERTER HOJE: R$ {saldo_final:.2f}")
        print("==================================================================")

if __name__ == "__main__":
    desfazer_operacoes_hoje()

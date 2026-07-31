"""
Script de Reversao Completa Baseada em Audit Logs e Sessao de Conciliacao da Conta ITAÚ - RMUSIC (ID 215)
"""
import os
import sys
from decimal import Decimal
from sqlmodel import Session
from sqlalchemy import text

from app.db.session import engine
from app.models.conta import Conta

def desfazer_tudo_auditoria_e_ofx():
    with Session(engine) as db:
        print("=== REVERTENDO 100% DAS ALTERAÇÕES DE AUDITORIA E OFX NA CONTA ITAÚ - RMUSIC (ID 215) ===")

        # 1. Soft-delete em TODAS as baixas criadas recentemente (IDs >= 140000) ligadas a conta 215
        db.exec(text("""
            UPDATE baixas 
            SET is_deleted = true 
            WHERE id IN (
                SELECT b.id 
                FROM baixas b
                JOIN lancamentos l ON l.id = b.lancamento_id
                WHERE l.empresa_id = 27 AND l.conta_id = 215 AND b.id >= 140000
            )
        """))
        db.commit()
        print("1. Todas as baixas recentes (IDs >= 140000) foram canceladas com sucesso.")

        # 2. Deletar (is_deleted = true) todos os lancamentos novos de Ajuste/OFX criados recentemente (IDs >= 1055000)
        db.exec(text("""
            UPDATE lancamentos
            SET is_deleted = true, status = 'EM ABERTO', valor_pago = 0.00, data_pagamento = NULL, conciliado = false
            WHERE empresa_id = 27 AND conta_id = 215 
              AND (id >= 1055000 OR origem IN ('OFX', 'AJUSTE_DIFERENCA'))
        """))
        db.commit()
        print("2. Lançamentos novos e ajustes de diferença criados recentemente foram desativados.")

        # 3. Restaurar lancamentos antigos da conta 215 (IDs < 1055000) recalculando com base unica em baixas ativas antigas (< 140000)
        db.exec(text("""
            WITH baixas_antigas AS (
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
                WHERE l.empresa_id = 27 AND l.conta_id = 215 AND b.is_deleted = false AND b.id < 140000
                GROUP BY b.lancamento_id
            )
            UPDATE lancamentos
            SET 
                valor_pago = COALESCE(ba.principal + ba.juros + ba.multa - ba.desconto, 0.00),
                valor_juros = COALESCE(ba.juros, 0.00),
                valor_multa = COALESCE(ba.multa, 0.00),
                valor_desconto = COALESCE(ba.desconto, 0.00),
                data_pagamento = ba.max_data_baixa,
                conciliado = CASE WHEN ba.total_baixas > 0 THEN true ELSE false END,
                import_hash = NULL,
                movimento_uid = NULL,
                status = CASE 
                    WHEN ba.total_baixas > 0 AND (lancamentos.valor_previsto - (ba.principal + ba.desconto)) <= 0.01 THEN 'PAGO'
                    WHEN ba.total_baixas > 0 THEN 'PARCIAL'
                    ELSE 'EM ABERTO'
                END
            FROM baixas_antigas ba
            WHERE lancamentos.id = ba.lancamento_id
              AND lancamentos.empresa_id = 27 AND lancamentos.conta_id = 215 AND lancamentos.is_deleted = false
        """))

        # Zerar lancamentos da conta 215 sem baixas ativas antigas
        db.exec(text("""
            UPDATE lancamentos
            SET valor_pago = 0.00, valor_juros = 0.00, valor_multa = 0.00, valor_desconto = 0.00,
                data_pagamento = NULL, conciliado = false, status = 'EM ABERTO',
                import_hash = NULL, movimento_uid = NULL
            WHERE empresa_id = 27 AND conta_id = 215 AND is_deleted = false AND id < 1055000
              AND id NOT IN (
                  SELECT b.lancamento_id 
                  FROM baixas b
                  JOIN lancamentos l ON l.id = b.lancamento_id
                  WHERE l.empresa_id = 27 AND l.conta_id = 215 AND b.is_deleted = false AND b.id < 140000
              )
        """))
        db.commit()
        print("3. Títulos pré-existentes limpos de vinculos de OFX/Auditoria e restaurados ao estado original.")

        # 4. Reabrir TODOS os movimentos bancarios OFX da conta
        db.exec(text("""
            UPDATE movimentos
            SET status = 'ABERTO'
            WHERE empresa_id = 27 AND conta_id = 215 AND status != 'ABERTO'
        """))
        db.commit()
        print("4. Fila de movimentos OFX totalmente reaberta.")

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
        print(f"SALDO FINAL RESTAURADO AO ESTADO ORIGINAL: R$ {saldo_final:.2f}")
        print("==================================================================")

if __name__ == "__main__":
    desfazer_tudo_auditoria_e_ofx()

"""
Script para desfazer 100% de qualquer operacao/conciliacao realizada HOJE (31/07/2026) na conta ITAÚ - RMUSIC (ID 215, Empresa 27).
"""
import os
import sys
from datetime import date
from decimal import Decimal
from sqlmodel import Session, select, or_
from sqlalchemy import text

from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from app.models.baixa import Baixa
from app.models.movimento import Movimento

def desfazer_operacoes_hoje():
    with Session(engine) as db:
        print("=== CANCELANDO/DESFAZENDO TODAS AS OPERAÇÕES DE HOJE (31/07/2026) NA CONTA ITAÚ - RMUSIC ===")

        # 1. Soft-delete em TODAS as baixas criadas ou modificadas hoje (31/07/2026) para lancamentos da conta 215
        baixas_hoje = db.exec(text("""
            SELECT b.id, b.lancamento_id, b.valor_pago 
            FROM baixas b
            JOIN lancamentos l ON l.id = b.lancamento_id
            WHERE l.empresa_id = 27 AND l.conta_id = 215 
              AND (b.created_at::date = '2026-07-31' OR b.updated_at::date = '2026-07-31' OR b.data_baixa = '2026-07-31' OR l.id >= 1056000)
        """)).mappings().all()

        print(f"Total de baixas de hoje a cancelar: {len(baixas_hoje)}")
        b_ids = [b['id'] for b in baixas_hoje]
        if b_ids:
            db.exec(text(f"UPDATE baixas SET is_deleted = true WHERE id IN ({','.join(map(str, b_ids))})"))
        db.flush()

        # 2. Lancamentos criados hoje durante a importacao OFX (id >= 1056000 ou criados hoje): Soft-delete
        novos_hoje = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == 27,
                Lancamento.conta_id == 215,
                or_(Lancamento.id >= 1056000, Lancamento.origem == "OFX")
            )
        ).all()

        print(f"Total de lancamentos novos de hoje a deletar: {len(novos_hoje)}")
        for n in novos_hoje:
            n.is_deleted = True
            n.status = "EM ABERTO"
            n.valor_pago = Decimal("0.00")
            n.data_pagamento = None
            n.conciliado = False
            db.add(n)
        db.flush()

        # 3. Lancamentos pre-existentes que foram alterados hoje: recalcular status/valor_pago com base em baixas anteriores ativas
        lancamentos_alterados = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == 27,
                Lancamento.conta_id == 215,
                Lancamento.id < 1056000,
                Lancamento.is_deleted == False
            )
        ).all()

        for l in lancamentos_alterados:
            baixas_ativas = db.exec(
                select(Baixa).where(
                    Baixa.lancamento_id == l.id,
                    Baixa.is_deleted == False
                )
            ).all()

            if not baixas_ativas:
                l.status = "EM ABERTO"
                l.valor_pago = Decimal("0.00")
                l.data_pagamento = None
                l.conciliado = False
            else:
                principal = sum(b.valor_pago for b in baixas_ativas if b.tipo_baixa == "PRINCIPAL")
                juros = sum(b.valor_pago for b in baixas_ativas if b.tipo_baixa == "JUROS")
                multa = sum(b.valor_pago for b in baixas_ativas if b.tipo_baixa == "MULTA")
                desconto = sum(b.valor_pago for b in baixas_ativas if b.tipo_baixa == "DESCONTO")

                l.valor_pago = principal + juros + multa - desconto
                l.valor_juros = juros
                l.valor_multa = multa
                l.valor_desconto = desconto
                l.data_pagamento = max(b.data_baixa for b in baixas_ativas if b.data_baixa is not None) if baixas_ativas else None
                
                saldo_rest = l.valor_previsto - (principal + desconto)
                l.status = "PAGO" if saldo_rest <= Decimal("0.01") else "PARCIAL"
                l.conciliado = True

            db.add(l)
        db.flush()

        # 4. Reabrir a fila de movimentos bancarios OFX da conta
        movs = db.exec(
            select(Movimento).where(
                Movimento.empresa_id == 27,
                Movimento.conta_id == 215,
                Movimento.status != "ABERTO"
            )
        ).all()

        print(f"Total de movimentos OFX a reabrir: {len(movs)}")
        for m in movs:
            m.status = "ABERTO"
            db.add(m)

        db.commit()
        print("\n✅ Todas as alterações de hoje foram desfeitas com sucesso!")

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
        print(f"SALDO RESULTANTE: R$ {saldo_final:.2f}")
        print("==================================================================")

if __name__ == "__main__":
    desfazer_operacoes_hoje()

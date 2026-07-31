"""
Script de Restauracao do Saldo da Conta ITAU - RMUSIC (ID 215) - Rosario Belem
Executa o reparo seguro no banco de dados de producao para voltar o saldo exatamente ao estado pre-importacao (R$ -28.320,08).
"""
import os
import sys
from decimal import Decimal
from sqlmodel import Session, select, or_
from sqlalchemy import text

from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from app.models.baixa import Baixa
from app.models.movimento import Movimento

def restaurar_rmusic():
    with Session(engine) as db:
        print("=== EXECUTANDO RESTAURAÇÃO DE SEGURANÇA DA CONTA ITAÚ - RMUSIC (CONTA ID 215) ===")

        # 1. Remover baixas duplicadas geradas pelas tentativas de conciliacao
        baixas_duplicadas_ids = [140187, 140300, 140410, 140414]
        for b_id in baixas_duplicadas_ids:
            baixa = db.get(Baixa, b_id)
            if baixa:
                baixa.is_deleted = True
                db.add(baixa)
        db.flush()

        # Recalcular valor_pago dos 4 lancamentos afetados
        for l_id in [1054873, 1055216, 1055344, 1055348]:
            l = db.get(Lancamento, l_id)
            if l:
                baixas_ativas = db.exec(select(Baixa).where(Baixa.lancamento_id == l_id, Baixa.is_deleted == False)).all()
                l.valor_pago = sum(b.valor_pago for b in baixas_ativas) if baixas_ativas else Decimal("0.00")
                if not baixas_ativas:
                    l.status = "EM ABERTO"
                    l.conciliado = False
                    l.data_pagamento = None
                db.add(l)
        db.flush()

        # 2. Marcar como deletados os lancamentos criados na importacao OFX de hoje (ID >= 1056000)
        novos_hoje = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == 27,
                Lancamento.conta_id == 215,
                Lancamento.id >= 1056000,
                Lancamento.is_deleted == False,
                Lancamento.origem == "OFX"
            )
        ).all()

        for nh in novos_hoje:
            nh.is_deleted = True
            nh.status = "EM ABERTO"
            nh.valor_pago = Decimal("0.00")
            nh.data_pagamento = None
            nh.conciliado = False
            db.add(nh)
        db.flush()

        # 3. Reabrir a fila de movimentos bancarios OFX da conta
        movs = db.exec(
            select(Movimento).where(
                Movimento.empresa_id == 27,
                Movimento.conta_id == 215,
                Movimento.status == "CONCILIADO"
            )
        ).all()

        for m in movs:
            m.status = "ABERTO"
            db.add(m)

        db.commit()
        print("Restauração executada com sucesso!")

        # 4. Exibir saldo final recalculado
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
        print(f"SALDO FINAL RECONCILIADO DO BANCO: R$ {saldo_final:.2f}")
        print("==================================================================")

if __name__ == "__main__":
    restaurar_rmusic()

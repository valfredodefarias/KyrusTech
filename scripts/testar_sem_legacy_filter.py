import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select, func
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date

def run():
    session = Session(engine)
    
    empresa_id = 35 # Umarizal
    
    # Obter categorias operacionais
    categorias = session.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == empresa_id, PlanoContas.is_deleted == False)
    ).all()
    
    receita_cat_ids = {c.id for c in categorias if (c.tipo or "").upper() == "R"}
    
    # Meses de 2026 a testar (Janeiro a Junho)
    meses_2026 = [
        (1, date(2026, 1, 1), date(2026, 1, 31), 524129.00),
        (2, date(2026, 2, 1), date(2026, 2, 28), 366701.00),
        (3, date(2026, 3, 1), date(2026, 3, 31), 400838.00),
        (4, date(2026, 4, 1), date(2026, 4, 30), 367007.00),
        (5, date(2026, 5, 1), date(2026, 5, 31), 393726.00),
        (6, date(2026, 6, 1), date(2026, 6, 30), 571478.00)
    ]
    
    print("=== COMPARATIVO DRE REPOSITÓRIO: VENCIMENTO VS COMPETÊNCIA ===")
    
    for mes, start, end, expected in meses_2026:
        print(f"\n--- MÊS {mes:02d}/2026 ---")
        print(f"  Esperado Planilha: R$ {expected:,.2f}")
        
        # 1. Filtro por Vencimento (Atual)
        launches_venc = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == "RECEITA",
                Lancamento.data_vencimento >= start,
                Lancamento.data_vencimento <= end
            )
        ).all()
        
        # Agrupar e somar considerando "competência" (regime de competência)
        val_venc = 0
        for l in launches_venc:
            if l.plano_contas_id in receita_cat_ids:
                comp = l.data_competencia or l.data_vencimento
                if start <= comp <= end:
                    val_pago = l.valor_pago if (l.data_pagamento is not None or (l.valor_pago and l.valor_pago != 0)) else l.valor_previsto
                    val_venc += val_pago
                    
        print(f"  Filtro por Vencimento: R$ {val_venc:,.2f} | Dif: R$ {(expected - float(val_venc)):,.2f}")
        
        # 2. Filtro por Competência (Corrigido)
        comp_date = func.coalesce(Lancamento.data_competencia, Lancamento.data_vencimento)
        launches_comp = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == "RECEITA",
                comp_date >= start,
                comp_date <= end
            )
        ).all()
        
        val_comp = 0
        for l in launches_comp:
            if l.plano_contas_id in receita_cat_ids:
                val_pago = l.valor_pago if (l.data_pagamento is not None or (l.valor_pago and l.valor_pago != 0)) else l.valor_previsto
                val_comp += val_pago
                
        print(f"  Filtro por Competência: R$ {val_comp:,.2f} | Dif: R$ {(expected - float(val_comp)):,.2f}")

if __name__ == "__main__":
    run()

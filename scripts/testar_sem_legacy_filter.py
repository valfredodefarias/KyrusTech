from sqlmodel import Session, select, or_
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date
from decimal import Decimal

def run():
    session = Session(engine)
    
    empresa_id = 35 # Umarizal
    
    # Obter categorias operacionais (RECEITA_BRUTA)
    categorias = session.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == empresa_id, PlanoContas.is_deleted == False)
    ).all()
    
    # Filtrar apenas as operacionais/receitas
    cat_by_id = {c.id: c for c in categorias}
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
    
    print("=== COMPARATIVO DRE REPOSITÓRIO: COM VS SEM FILTRO LEGADO ===")
    
    for mes, start, end, expected in meses_2026:
        print(f"\n--- MÊS {mes:02d}/2026 ---")
        print(f"  Esperado Planilha: R$ {expected:,.2f}")
        
        # 1. Com filtro legacy (comportamento atual da API)
        launches_com = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == "RECEITA",
                Lancamento.data_vencimento >= start,
                Lancamento.data_vencimento <= end,
                or_(
                    Lancamento.observacao.is_(None),
                    (~Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%") & ~Lancamento.observacao.ilike('%"legacy_id_venda"%'))
                )
            )
        ).all()
        
        val_com = sum(l.valor_previsto for l in launches_com if l.plano_contas_id in receita_cat_ids)
        print(f"  API Atual (Com Filtro legacy): R$ {val_com:,.2f} | Dif: R$ {(expected - float(val_com)):,.2f}")
        
        # 2. Sem filtro legacy (proposta)
        launches_sem = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == "RECEITA",
                Lancamento.data_vencimento >= start,
                Lancamento.data_vencimento <= end
            )
        ).all()
        
        val_sem = sum(l.valor_previsto for l in launches_sem if l.plano_contas_id in receita_cat_ids)
        print(f"  Proposto (Sem Filtro legacy): R$ {val_sem:,.2f} | Dif: R$ {(expected - float(val_sem)):,.2f}")

if __name__ == "__main__":
    run()

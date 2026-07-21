from sqlmodel import Session, select, func
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date

def run():
    session = Session(engine)
    
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    cat_by_id = {c.id: c for c in categorias}
    
    # Buscar lançamentos de receita da categoria 01.01.02 (Cartão Crédito) em Jan/2026
    # Filtrando por data de competência
    comp_date = func.coalesce(Lancamento.data_competencia, Lancamento.data_vencimento)
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.plano_contas_id == 6203, # ID de 01.01.02 em Umarizal
            Lancamento.is_deleted == False,
            comp_date >= start,
            comp_date <= end
        )
    ).all()
    
    print(f"=== ANÁLISE DE TAXAS E VALORES DE CARTÃO DE CRÉDITO ===")
    print(f"Total de lançamentos de Cartão de Crédito: {len(launches)}")
    
    sum_previsto = sum(l.valor_previsto for l in launches)
    sum_pago = sum(l.valor_pago or 0 for l in launches)
    
    # Calcular o valor real usado pela DRE
    sum_dre_val = 0
    for l in launches:
        val_pago = l.valor_pago or 0
        if l.data_pagamento is not None or val_pago != 0:
            val = val_pago if val_pago != 0 else l.valor_previsto
        else:
            val = l.valor_previsto
        sum_dre_val += val
        
    print(f"  Soma Valor Previsto (Gross/Bruto): R$ {sum_previsto:,.2f}")
    print(f"  Soma Valor Pago (Net/Líquido):   R$ {sum_pago:,.2f}")
    print(f"  Soma Calculada pela DRE:          R$ {sum_dre_val:,.2f}")
    print(f"  Diferença (DRE vs Bruto):        R$ {(sum_previsto - sum_dre_val):,.2f}")
    
    # Mostrar os primeiros 5 lançamentos
    print("\n--- Detalhes dos Primeiros 5 Lançamentos ---")
    for l in launches[:5]:
        print(f"  ID: {l.id} | Previsto (Bruto): R$ {l.valor_previsto:.2f} | Pago (Líquido): R$ {l.valor_pago} | Pagamento: {l.data_pagamento}")

if __name__ == "__main__":
    run()

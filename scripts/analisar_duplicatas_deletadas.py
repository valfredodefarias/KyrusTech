from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from datetime import date
from collections import defaultdict

def run():
    session = Session(engine)
    
    # Umarizal (35) - Jan/2026
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    # Buscar todos os lançamentos (ativos e deletados) em Jan/2026
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.data_vencimento >= start,
            Lancamento.data_vencimento <= end
        )
    ).all()
    
    # Agrupar lançamentos PDV ativos por (data, valor)
    pdv_by_date_val = defaultdict(list)
    for l in launches:
        if l.origem == "PDV" and not l.is_deleted:
            val = round(float(l.valor_previsto), 2)
            pdv_by_date_val[(l.data_vencimento, val)].append(l)
            
    # Verificar cada lançamento WEB que foi deletado
    deleted_web = [l for l in launches if l.origem == "WEB" and l.is_deleted]
    
    print("=== ANÁLISE DE VERIFICAÇÃO DE DUPLICATAS DELETADAS ===")
    print(f"Total de lançamentos WEB deletados analisados: {len(deleted_web)}")
    
    match_count = 0
    no_match_count = 0
    no_match_total_value = 0.0
    
    no_match_items = []
    
    for l in deleted_web:
        val = round(float(l.valor_previsto), 2)
        # Buscar se existe algum PDV ativo com mesma data e valor
        matches = pdv_by_date_val.get((l.data_vencimento, val), [])
        if matches:
            match_count += 1
            # Consumir o match para evitar múltiplos matches para o mesmo PDV
            matches.pop(0)
        else:
            no_match_count += 1
            no_match_total_value += float(l.valor_previsto)
            no_match_items.append(l)
            
    print(f"  * Duplicados Reais (com match exato de data e valor em PDV): {match_count}")
    print(f"  * Não-Duplicados Deletados por Engano (sem match em PDV): {no_match_count}")
    print(f"  * Valor total dos lançamentos deletados por engano: R$ {no_match_total_value:,.2f}")
    
    print("\n--- Exemplos de lançamentos deletados por engano (Top 20 maiores) ---")
    for l in sorted(no_match_items, key=lambda x: x.valor_previsto, reverse=True)[:20]:
        print(f"  ID: {l.id} | Data: {l.data_vencimento} | Valor: R$ {l.valor_previsto:<8.2f} | Desc: '{l.descricao}' | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()

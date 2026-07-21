from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date
from decimal import Decimal

def run():
    session = Session(engine)
    
    # Umarizal (35) - Jan/2026
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    # Buscar todos os lançamentos de receita em Jan/2026 (ativos e deletados)
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.data_vencimento >= start,
            Lancamento.data_vencimento <= end
        )
    ).all()
    
    print("=== ANÁLISE DE PIX JANEIRO/2026 ===")
    
    # Agrupar por origem e status de exclusão
    print("\n--- Todos os lançamentos de Receita por Origem e Exclusão ---")
    origens = {}
    for l in launches:
        key = (l.origem, l.is_deleted)
        origens.setdefault(key, []).append(l)
        
    for (orig, is_del), items in sorted(origens.items()):
        val_sum = sum(i.valor_previsto for i in items)
        print(f"  Origem: {orig:<5} | Excluído: {str(is_del):<5} | Qtd: {len(items):<5} | Valor Total: R$ {val_sum:,.2f}")
        
    # Investigar especificamente as categorias de PIX (01.01.04 e 01.01.05)
    # IDs das categorias
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    pix_cat_ids = {c.id for c in categorias if c.codigo in ("01.01.04", "01.01.05")}
    
    print("\n--- Lançamentos nas Categorias de PIX (01.01.04 e 01.01.05) ---")
    pix_launches = [l for l in launches if l.plano_contas_id in pix_cat_ids]
    
    pix_origens = {}
    for l in pix_launches:
        key = (l.origem, l.is_deleted)
        pix_origens.setdefault(key, []).append(l)
        
    for (orig, is_del), items in sorted(pix_origens.items()):
        val_sum = sum(i.valor_previsto for i in items)
        print(f"  Origem: {orig:<5} | Excluído: {str(is_del):<5} | Qtd: {len(items):<5} | Valor Total: R$ {val_sum:,.2f}")
        
    # Mostrar os 10 maiores lançamentos de PIX de origem WEB que foram deletados
    deleted_web_pix = [l for l in pix_launches if l.origem == "WEB" and l.is_deleted == True]
    print("\n--- Top 10 Maiores PIX WEB Deletados ---")
    for l in sorted(deleted_web_pix, key=lambda x: x.valor_previsto, reverse=True)[:10]:
        print(f"  ID: {l.id} | Data: {l.data_vencimento} | Valor: R$ {l.valor_previsto:.2f} | Desc: '{l.descricao}' | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()

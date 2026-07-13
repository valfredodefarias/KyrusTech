# scripts/inspect_marco_transactions.py
from sqlmodel import Session, select, func
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta

def main():
    print("=== INSPECTING DATABASE TRANSACTIONS FOR PIZZA FÁBIO MARCO (ID: 76) ===")
    db = Session(engine)
    try:
        # Get company accounts
        accounts = db.exec(select(Conta).where(Conta.empresa_id == 76)).all()
        print(f"Contas bancárias cadastradas ({len(accounts)}):")
        for acc in accounts:
            # Count transactions in this account
            tx_count = db.exec(
                select(func.count(Lancamento.id))
                .where(Lancamento.conta_id == acc.id, Lancamento.is_deleted == False)
            ).first() or 0
            
            rec_count = db.exec(
                select(func.count(Lancamento.id))
                .where(Lancamento.conta_id == acc.id, Lancamento.tipo == "RECEITA", Lancamento.is_deleted == False)
            ).first() or 0
            
            desp_count = db.exec(
                select(func.count(Lancamento.id))
                .where(Lancamento.conta_id == acc.id, Lancamento.tipo == "DESPESA", Lancamento.is_deleted == False)
            ).first() or 0
            
            print(f"  - Account: {acc.nome} (ID: {acc.id}) | Total: {tx_count} | Receitas: {rec_count} | Despesas: {desp_count}")

        # Count total transactions by type
        total_rec = db.exec(select(func.count(Lancamento.id)).where(Lancamento.empresa_id == 76, Lancamento.tipo == "RECEITA", Lancamento.is_deleted == False)).first() or 0
        total_desp = db.exec(select(func.count(Lancamento.id)).where(Lancamento.empresa_id == 76, Lancamento.tipo == "DESPESA", Lancamento.is_deleted == False)).first() or 0
        print(f"\nTotal Geral de Lançamentos - Receitas: {total_rec} | Despesas: {total_desp}")

        # Top categories for Marco transactions
        print("\nCategorias mais usadas nos lançamentos de Marco:")
        categories_stats = db.exec(
            select(PlanoContas.codigo, PlanoContas.nome, PlanoContas.tipo, func.count(Lancamento.id))
            .join(Lancamento, Lancamento.plano_contas_id == PlanoContas.id)
            .where(Lancamento.empresa_id == 76, Lancamento.is_deleted == False)
            .group_by(PlanoContas.codigo, PlanoContas.nome, PlanoContas.tipo)
            .order_by(func.count(Lancamento.id).desc())
        ).all()
        
        for code, name, tipo, count in categories_stats[:20]:
            print(f"  - {code} {name} (Tipo Plano: {tipo}) | Lançamentos: {count}")
            
    except Exception as e:
        print(f"Erro ao inspecionar lançamentos: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()

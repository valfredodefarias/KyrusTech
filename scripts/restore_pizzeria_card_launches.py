import sys
import os
import argparse
from pathlib import Path
from datetime import date, datetime

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    parser = argparse.ArgumentParser(description="Reativa lancamentos de cartao agrupados deletados estritamente para as Pizzarias Fábio a partir de 28/07/2026.")
    parser.add_argument("--commit", action="store_true", help="Aplica as alteracoes no banco de dados.")
    parser.add_argument("--start-date", type=str, default="2026-07-28", help="Data inicial de vencimento (YYYY-MM-DD). Padrao: 2026-07-28.")
    args = parser.parse_args()

    filter_start_date = datetime.strptime(args.start_date, "%Y-%m-%d").date()

    from sqlmodel import Session, select
    from app.db.session import engine
    from app.models import Empresa, Lancamento

    # Apenas as 4 lojas Pizza Fábio
    pizzeria_ids = [35, 37, 39, 40]

    with Session(engine) as session:
        empresas = session.exec(select(Empresa).where(Empresa.id.in_(pizzeria_ids))).all()
        emp_names = {e.id: (getattr(e, 'nome_fantasia', None) or getattr(e, 'razao_social', None) or f"Empresa #{e.id}") for e in empresas}

        print("==========================================================================")
        print("RESTAURAÇÃO CIRÚRGICA DE RECEBÍVEIS DE CARTÃO - PIZZARIAS FÁBIO")
        print(f"Filtro de Vencimento: {filter_start_date.strftime('%d/%m/%Y')} em diante (HOJE EM DIANTE)")
        print("==========================================================================")
        print(f"Modo: {'⚠️ APLICAÇÃO REAL (--commit)' if args.commit else '🔍 SIMULAÇÃO (Dry Run - Use --commit para aplicar)'}\n")

        query = (
            select(Lancamento)
            .where(
                Lancamento.empresa_id.in_(pizzeria_ids),
                Lancamento.tipo == "RECEITA",
                Lancamento.is_deleted == True,
                Lancamento.data_vencimento >= filter_start_date
            )
        )
        lancs = session.exec(query).all()
        target_lancs = [l for l in lancs if 'grouped_card_launch' in (l.observacao or '')]

        print(f"📌 Total de recebíveis de cartão soft-deleted encontrados a partir de {filter_start_date.strftime('%d/%m/%Y')}: {len(target_lancs)}\n")

        total_valor = 0.0
        by_emp = {}
        for l in target_lancs:
            val = float(l.valor_previsto or 0)
            total_valor += val
            emp_name = emp_names.get(l.empresa_id, f"Empresa #{l.empresa_id}")
            by_emp.setdefault(emp_name, []).append(l)

        for emp_name, items in by_emp.items():
            subtotal = sum(float(x.valor_previsto or 0) for x in items)
            print(f"🏢 {emp_name} ({len(items)} recebíveis | Subtotal: R$ {subtotal:,.2f}):")
            for item in items:
                print(f"   [ID {item.id}] {item.descricao:<22} | Valor: R$ {float(item.valor_previsto):>8.2f} | Vencimento: {item.data_vencimento}")

        print(f"\n💰 VALOR TOTAL A SER REATIVADO: R$ {total_valor:,.2f}")

        if args.commit and target_lancs:
            for item in target_lancs:
                item.is_deleted = False
                session.add(item)
            session.commit()
            print(f"\n✅ SUCESSO: Todos os {len(target_lancs)} recebíveis de cartão foram reativados no banco de dados!")
        else:
            print("\nℹ️ Nenhuma alteração foi realizada. Execute com `--commit` para aplicar as mudanças.")

if __name__ == "__main__":
    main()

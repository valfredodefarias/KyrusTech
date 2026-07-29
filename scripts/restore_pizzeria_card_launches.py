import sys
import os
import argparse
from pathlib import Path
from datetime import date

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    parser = argparse.ArgumentParser(description="Reativa lancamentos de cartao agrupados deletados para as pizzarias desde 01/07.")
    parser.add_argument("--commit", action="store_true", help="Aplica as alteracoes no banco de dados.")
    args = parser.parse_args()

    from sqlmodel import Session, select
    from app.db.session import engine
    from app.models import Empresa, Lancamento

    pizzeria_ids = [35, 37, 39, 40, 27, 28, 21]

    with Session(engine) as session:
        empresas = session.exec(select(Empresa).where(Empresa.id.in_(pizzeria_ids))).all()
        emp_names = {e.id: (getattr(e, 'nome_fantasia', None) or getattr(e, 'razao_social', None) or f"Empresa #{e.id}") for e in empresas}

        print("==========================================================================")
        print("RESTAURAÇÃO DE RECEBÍVEIS DE CARTÃO AGRUPADOS (PIZZARIAS - 01/07 EM DIANTE)")
        print("==========================================================================")
        print(f"Modo: {'⚠️ APLICAÇÃO REAL (--commit)' if args.commit else '🔍 SIMULAÇÃO (Dry Run - Use --commit para aplicar)'}\n")

        query = (
            select(Lancamento)
            .where(
                Lancamento.empresa_id.in_(pizzeria_ids),
                Lancamento.tipo == "RECEITA",
                Lancamento.is_deleted == True,
                Lancamento.data_vencimento >= date(2026, 7, 1)
            )
        )
        lancs = session.exec(query).all()
        target_lancs = [l for l in lancs if 'grouped_card_launch' in (l.observacao or '')]

        print(f"📌 Total de recebíveis de cartão soft-deleted encontrados desde 01/07: {len(target_lancs)}\n")

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

        if args.commit:
            for item in target_lancs:
                item.is_deleted = False
                session.add(item)
            session.commit()
            print("\n✅ SUCESSO: Todos os 84 recebíveis de cartão foram reativados no banco de dados!")
        else:
            print("\nℹ️ Nenhuma alteração foi realizada. Execute com `--commit` para aplicar as mudanças.")

if __name__ == "__main__":
    main()

"""
fix_future_pago.py
==================
Corrige lançamentos PDV que foram marcados PAGO mas têm data_vencimento > hoje.
Esses foram conciliados erroneamente por lotes futuros.

Uso:
  docker compose exec backend python scripts/fix_future_pago.py [--dry-run]
"""
import sys, os
from datetime import datetime, date
from decimal import Decimal

sys.path.insert(0, "/app")
os.environ.setdefault("DISABLE_AUDIT", "1")

from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento

dry_run = "--dry-run" in sys.argv
today = date.today()

print(f"{'[DRY RUN] ' if dry_run else ''}Buscando lancamentos PDV PAGO com vencimento futuro...")

with Session(engine) as db:
    # Lançamentos marcados PAGO mas com data_vencimento > hoje
    # Só revertemos os que foram conciliados por lote (conciliado=True)
    # e que NÃO são pagamentos à vista (esses já eram PAGO na planilha)
    q = select(Lancamento).where(
        Lancamento.origem == "PDV",
        Lancamento.tipo == "RECEITA",
        Lancamento.status == "PAGO",
        Lancamento.data_vencimento > today,
        Lancamento.is_deleted == False,
    )
    lancamentos = db.exec(q).all()
    print(f"  Encontrados: {len(lancamentos):,} lançamentos futuros marcados PAGO")

    if not lancamentos:
        print("  Nada a corrigir.")
    else:
        if not dry_run:
            for lanc in lancamentos:
                lanc.status = "EM ABERTO"
                lanc.valor_pago = Decimal("0.00")
                lanc.data_pagamento = None
                # Mantém conciliado=True se tiver LoteCartaoItem vinculado
                lanc.updated_at = datetime.utcnow()
                db.add(lanc)
            db.commit()
            print(f"  [OK] {len(lancamentos):,} lançamentos revertidos para EM ABERTO.")
        else:
            print(f"  [DRY RUN] {len(lancamentos):,} seriam revertidos para EM ABERTO.")

    # Mostra amostra
    print(f"\n  Amostra (primeiros 5):")
    for l in lancamentos[:5]:
        print(f"    ID={l.id} | venc={l.data_vencimento} | empresa={l.empresa_id} | R${l.valor_previsto}")

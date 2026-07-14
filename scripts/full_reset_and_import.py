"""
full_reset_and_import.py
========================
Script completo para limpeza + reimportação + conciliação das Pizza Fábio.

Etapas:
  1. Backup automático (pg_dump)
  2. Wipe de todos os dados das 4 empresas (35, 37, 39, 40)
  3. Reimportação completa de todas as planilhas
  4. Auto-conciliação de LoteCartao (match de depósitos)
  5. Force-PAGO: marca como PAGO todos os recebíveis vencidos

Uso:
  docker compose exec backend python scripts/full_reset_and_import.py [--dry-run]

Opções:
  --dry-run   Mostra o que seria feito sem alterar nada
  --no-backup Pula o pg_dump (útil em ambientes sem pg_dump disponível)
  --no-wipe   Pula a etapa de wipe (só importa e concilia)
"""
import sys, os, subprocess, time, json, argparse
from pathlib import Path
from datetime import date, datetime
from decimal import Decimal

# ── Setup do path ────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))
os.environ.setdefault("DISABLE_AUDIT", "1")

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.session import engine
from app.core.config import settings
from app.models.lancamento import Lancamento
from app.models.lote_cartao import LoteCartao
from app.models.lote_cartao_item import LoteCartaoItem

EMPRESA_IDS = (35, 37, 39, 40)  # Umarizal, Ananindeua, Marco Salão, Marco Delivery

# ── Tabelas a deletar (ordem FK: filhos primeiro) ────────────────────────────
DELETIONS = [
    ("pdv_venda_itens",
     "venda_id IN (SELECT id FROM pdv_vendas WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("baixas",
     "lancamento_id IN (SELECT id FROM lancamentos WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("anexos_lancamento",
     "lancamento_id IN (SELECT id FROM lancamentos WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("alertas_anomalia",      "empresa_id = ANY('{35,37,39,40}')"),
    ("audit_logs",            "empresa_id = ANY('{35,37,39,40}')"),
    ("lancamentos",           "empresa_id = ANY('{35,37,39,40}')"),
    ("pdv_movimentacoes",     "empresa_id = ANY('{35,37,39,40}')"),
    ("pdv_ifood_lancamentos", "empresa_id = ANY('{35,37,39,40}')"),
    ("pdv_vendas",            "empresa_id = ANY('{35,37,39,40}')"),
    ("lote_cartao_itens",
     "lote_cartao_id IN (SELECT id FROM lotes_cartao WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("lotes_cartao",          "empresa_id = ANY('{35,37,39,40}')"),
    ("mapeamentos_categoria",
     "integracao_id IN (SELECT id FROM integracoes_bancarias WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("integracoes_bancarias", "empresa_id = ANY('{35,37,39,40}')"),
    ("regras_cartao",         "empresa_id = ANY('{35,37,39,40}')"),
    ("regras_comissao",       "empresa_id = ANY('{35,37,39,40}')"),
    ("metas_vendedores",      "empresa_id = ANY('{35,37,39,40}')"),
    ("orcamentos",            "empresa_id = ANY('{35,37,39,40}')"),
    ("movimentos",            "empresa_id = ANY('{35,37,39,40}')"),
    ("movimentacoes_estoque", "empresa_id = ANY('{35,37,39,40}')"),
    ("fornecedor_produto_equivalencias",
     "produto_id IN (SELECT id FROM produtos WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("produtos",              "empresa_id = ANY('{35,37,39,40}')"),
    ("entidades",             "empresa_id = ANY('{35,37,39,40}')"),
    ("dashboard_view_configs","empresa_id = ANY('{35,37,39,40}')"),
    ("plano_contas_template_configs", "empresa_id = ANY('{35,37,39,40}')"),
    ("plano_contas",          "empresa_id = ANY('{35,37,39,40}')"),
    ("centros_custo",         "empresa_id = ANY('{35,37,39,40}')"),
    ("usuario_conta_acesso",
     "conta_id IN (SELECT id FROM contas WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("contas",                "empresa_id = ANY('{35,37,39,40}')"),
    ("user_company_profiles",
     "empresa_id = ANY('{35,37,39,40}') AND usuario_id IN "
     "(SELECT id FROM usuarios WHERE empresa_id = ANY('{35,37,39,40}') AND is_consultor = FALSE)"),
    ("access_profile_permissions",
     "profile_id IN (SELECT id FROM access_profiles WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("access_profiles",       "empresa_id = ANY('{35,37,39,40}')"),
    ("usuarios",
     "empresa_id = ANY('{35,37,39,40}') AND is_consultor = FALSE"),
]

# ─────────────────────────────────────────────────────────────────────────────
# ETAPA 1 — Backup
# ─────────────────────────────────────────────────────────────────────────────
def step_backup():
    print("\n" + "=" * 60)
    print("ETAPA 1 — BACKUP (pg_dump)")
    print("=" * 60)
    os.makedirs("/app/backups", exist_ok=True)
    dump_path = f"/app/backups/backup_pre_reset_{datetime.now().strftime('%Y%m%d_%H%M%S')}.dump"
    cmd = [
        "pg_dump",
        "-h", settings.POSTGRES_SERVER,
        "-p", str(settings.POSTGRES_PORT),
        "-U", settings.POSTGRES_USER,
        "-d", settings.POSTGRES_DB,
        "-F", "c", "-b", "-v",
        "-f", dump_path,
    ]
    env = os.environ.copy()
    env["PGPASSWORD"] = settings.POSTGRES_PASSWORD
    try:
        subprocess.run(cmd, env=env, check=True, capture_output=True, text=True)
        print(f"  [OK] Backup salvo em: {dump_path}")
    except subprocess.CalledProcessError as e:
        print(f"  [AVISO] pg_dump falhou: {e.stderr[:300]}")
        print("  Continuando sem backup...")


# ─────────────────────────────────────────────────────────────────────────────
# ETAPA 2 — Wipe
# ─────────────────────────────────────────────────────────────────────────────
def step_wipe(dry_run: bool):
    print("\n" + "=" * 60)
    print(f"ETAPA 2 — WIPE {'[DRY RUN]' if dry_run else '[EXECUÇÃO REAL]'}")
    print(f"Empresas: {EMPRESA_IDS}")
    print("=" * 60)

    if dry_run:
        with engine.connect() as conn:
            for table, where in [
                ("lancamentos",           "empresa_id = ANY('{35,37,39,40}')"),
                ("pdv_vendas",            "empresa_id = ANY('{35,37,39,40}')"),
                ("pdv_ifood_lancamentos", "empresa_id = ANY('{35,37,39,40}')"),
                ("lotes_cartao",          "empresa_id = ANY('{35,37,39,40}')"),
                ("contas",                "empresa_id = ANY('{35,37,39,40}')"),
            ]:
                try:
                    r = conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE {where}"))
                    print(f"  {table}: {r.scalar():,} registros seriam removidos")
                except Exception:
                    pass
        print("  [DRY RUN] Nenhuma alteração.")
        return

    t0 = time.time()
    total_deleted = 0
    with engine.begin() as conn:
        conn.execute(text("SET session_replication_role = replica"))
        for table, where in DELETIONS:
            sp = f"sp_{table}"
            conn.execute(text(f"SAVEPOINT {sp}"))
            try:
                r = conn.execute(text(f"DELETE FROM {table} WHERE {where}"))
                conn.execute(text(f"RELEASE SAVEPOINT {sp}"))
                if r.rowcount > 0:
                    print(f"  [{r.rowcount:>8,}] {table}")
                    total_deleted += r.rowcount
            except Exception as e:
                conn.execute(text(f"ROLLBACK TO SAVEPOINT {sp}"))
                msg = str(e)
                if "does not exist" in msg or "UndefinedTable" in msg or "UndefinedColumn" in msg:
                    print(f"  [SKIP] {table}")
                else:
                    print(f"  [ERRO] {table}: {e}")
        conn.execute(text("SET session_replication_role = DEFAULT"))

    print(f"\n  [OK] Wipe concluído em {time.time()-t0:.1f}s — {total_deleted:,} registros removidos")


# ─────────────────────────────────────────────────────────────────────────────
# ETAPA 3 — Importação
# ─────────────────────────────────────────────────────────────────────────────
def step_import(dry_run: bool):
    print("\n" + "=" * 60)
    print(f"ETAPA 3 — IMPORTAÇÃO {'[DRY RUN]' if dry_run else ''}")
    print("=" * 60)

    from scripts.import_pizza_fabio import import_all_data

    with Session(engine) as db:
        import_all_data(
            db=db,
            path_umarizal="scripts/Base_PizzaFabioUmarizal.xlsx",
            path_ananindeua="scripts/Base_PizzaFabioAnanindeua.xlsx",
            path_ifood_marco="scripts/Base_IFood_PizzaFabioMarco.xlsx",
            path_marco_salao="scripts/Base_PizzaFabioMarco.xlsx",
            dry_run=dry_run,
        )
    print("  [OK] Importação concluída.")


# ─────────────────────────────────────────────────────────────────────────────
# ETAPA 4 — Auto-conciliação de LoteCartao
# ─────────────────────────────────────────────────────────────────────────────
BANDEIRA_ALIASES = {
    "MASTER": "MASTER", "MASTERCARD": "MASTER",
    "VISA": "VISA", "VISADEBIT": "VISA",
    "ELO": "ELO", "ELODEBIT": "ELO",
    "AMEX": "AMEX", "AMERICANEXPRESS": "AMEX",
    "HIPERCARD": "HIPERCARD",
    "IFOOD": "IFOOD",
    "PIX": "PIX",
    "OUTROS": "OUTROS",
}

def norm_band(b: str) -> str:
    if not b:
        return "OUTROS"
    b = b.upper().replace(" ", "").replace("-", "")
    return BANDEIRA_ALIASES.get(b, b)

def step_reconciliar(dry_run: bool):
    print("\n" + "=" * 60)
    print(f"ETAPA 4 — CONCILIAÇÃO LOTE CARTÃO {'[DRY RUN]' if dry_run else ''}")
    print("=" * 60)

    from collections import defaultdict

    total_matched = 0
    total_pago = 0

    with Session(engine) as db:
        empresa_ids = list(db.exec(
            select(LoteCartao.empresa_id)
            .where(LoteCartao.lancamento_deposito_id.is_(None))
            .distinct()
        ).all())
        print(f"  Empresas com lotes pendentes: {empresa_ids}")

        for emp_id in empresa_ids:
            print(f"\n  --- Empresa {emp_id} ---")

            lotes = db.exec(
                select(LoteCartao)
                .where(LoteCartao.empresa_id == emp_id,
                       LoteCartao.lancamento_deposito_id.is_(None))
                .order_by(LoteCartao.data_pagamento)
            ).all()

            # Índice de lançamentos PDV EM ABERTO
            lancs_pdv = db.exec(
                select(Lancamento)
                .where(Lancamento.empresa_id == emp_id,
                       Lancamento.origem == "PDV",
                       Lancamento.status == "EM ABERTO",
                       Lancamento.tipo == "RECEITA",
                       Lancamento.is_deleted == False)
            ).all()

            lanc_idx = defaultdict(list)
            for l in lancs_pdv:
                try:
                    meta = json.loads(l.observacao or "{}")
                    band_k = norm_band(meta.get("bandeira", "OUTROS"))
                except Exception:
                    band_k = "OUTROS"
                lanc_idx[(l.data_vencimento, band_k)].append(l)

            matched = unmatched = em_pago = 0
            for lote in lotes:
                lote_band = norm_band(lote.bandeira or "")
                candidates = lanc_idx.get((lote.data_pagamento, lote_band), [])
                if not candidates:
                    candidates = lanc_idx.get((lote.data_pagamento, "OUTROS"), [])
                if not candidates:
                    # tolerância ±1 dia
                    from datetime import timedelta
                    for delta in [1, -1]:
                        td = lote.data_pagamento + timedelta(days=delta) if lote.data_pagamento else None
                        candidates = lanc_idx.get((td, lote_band), [])
                        if candidates:
                            break

                if not candidates:
                    unmatched += 1
                    continue

                if not dry_run:
                    for lanc in list(candidates):
                        try:
                            meta = json.loads(lanc.observacao or "{}")
                            taxa_v = Decimal(str(meta.get("cartao_taxa_valor", 0.0)))
                        except Exception:
                            taxa_v = Decimal("0.00")

                        item = LoteCartaoItem(
                            lote_cartao_id=lote.id,
                            lancamento_id=lanc.id,
                            valor_bruto=lanc.valor_previsto,
                            valor_taxa=taxa_v,
                            valor_liquido=lanc.valor_previsto - taxa_v,
                        )
                        db.add(item)
                        lanc.status = "PAGO"
                        lanc.data_pagamento = lote.data_pagamento
                        lanc.valor_pago = lanc.valor_previsto
                        lanc.conta_id = lote.conta_destino_id
                        lanc.conciliado = True
                        lanc.updated_at = datetime.utcnow()
                        db.add(lanc)

                        b_k = norm_band(json.loads(lanc.observacao or "{}").get("bandeira", "OUTROS"))
                        key = (lanc.data_vencimento, b_k)
                        if lanc in lanc_idx.get(key, []):
                            lanc_idx[key].remove(lanc)

                em_pago += len(candidates)
                matched += 1

            print(f"    Lotes matched: {matched:,} | Sem match: {unmatched:,}")
            print(f"    Lançamentos a marcar PAGO: {em_pago:,}")
            total_matched += matched
            total_pago += em_pago

        if not dry_run:
            db.commit()
            print(f"\n  [OK] Conciliação salva.")

    print(f"  Total lotes conciliados: {total_matched:,}")
    print(f"  Total lançamentos PAGO (lote match): {total_pago:,}")
    return total_pago


# ─────────────────────────────────────────────────────────────────────────────
# ETAPA 5 — Force-PAGO: recebíveis vencidos
# ─────────────────────────────────────────────────────────────────────────────
def step_force_pago(dry_run: bool):
    print("\n" + "=" * 60)
    print(f"ETAPA 5 — FORCE-PAGO (recebíveis vencidos) {'[DRY RUN]' if dry_run else ''}")
    print("=" * 60)

    today = date.today()
    with Session(engine) as db:
        force_q = select(Lancamento).where(
            Lancamento.origem == "PDV",
            Lancamento.status == "EM ABERTO",
            Lancamento.tipo == "RECEITA",
            Lancamento.data_vencimento < today,
            Lancamento.is_deleted == False,
        )
        force_list = db.exec(force_q).all()
        print(f"  Recebíveis vencidos EM ABERTO: {len(force_list):,}")

        if not dry_run:
            for lanc in force_list:
                lanc.status = "PAGO"
                lanc.valor_pago = lanc.valor_previsto
                lanc.data_pagamento = lanc.data_vencimento
                lanc.conciliado = True
                lanc.updated_at = datetime.utcnow()
                db.add(lanc)
            db.commit()
            print(f"  [OK] {len(force_list):,} lançamentos marcados PAGO.")
        else:
            print(f"  [DRY RUN] {len(force_list):,} seriam marcados PAGO.")

    return len(force_list)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Reset + reimport + conciliação Pizza Fábio")
    parser.add_argument("--dry-run",   action="store_true", help="Simula sem alterar o banco")
    parser.add_argument("--no-backup", action="store_true", help="Pula o pg_dump")
    parser.add_argument("--no-wipe",   action="store_true", help="Pula o wipe (só importa)")
    args = parser.parse_args()

    print("=" * 60)
    print("FULL RESET & IMPORT — PIZZA FÁBIO")
    print(f"Empresas: {EMPRESA_IDS}")
    print(f"Modo: {'DRY RUN' if args.dry_run else 'EXECUÇÃO REAL'}")
    print("=" * 60)

    if not args.dry_run and not args.no_wipe:
        confirm = input("\nIsso irá APAGAR todos os dados das empresas 35, 37, 39, 40.\nDigite SIM para continuar: ")
        if confirm.strip().upper() != "SIM":
            print("Cancelado.")
            sys.exit(0)

    t_total = time.time()

    # 1. Backup
    if not args.no_backup and not args.dry_run:
        step_backup()

    # 2. Wipe
    if not args.no_wipe:
        step_wipe(dry_run=args.dry_run)

    # 3. Importação
    step_import(dry_run=args.dry_run)

    # 4. Conciliação de lotes
    step_reconciliar(dry_run=args.dry_run)

    # 5. Force-PAGO
    step_force_pago(dry_run=args.dry_run)

    elapsed = time.time() - t_total
    print("\n" + "=" * 60)
    print(f"CONCLUÍDO em {elapsed/60:.1f} min")
    print("=" * 60)


if __name__ == "__main__":
    main()

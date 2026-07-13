# scripts/wipe_pizza_fabio.py
# Apaga TODOS os dados das 4 empresas Pizza Fábio usando SQL direto (rápido).
# As empresas em si (IDs) são preservadas. Consultores e acessos são preservados.
# Usuários operadores (não-consultores) das empresas são removidos.
import sys
from pathlib import Path
from sqlalchemy import text

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine

EMPRESA_IDS = (35, 37, 39, 40)  # Umarizal, Ananindeua, Marco Salão, Marco Delivery
IDS_SQL = "'{35, 37, 39, 40}'"  # Postgres array literal

DRY_RUN = "--dry-run" in sys.argv

# Ordered deletions respecting FK constraints (children first)
# Each tuple: (table, filter_expression)
DELETIONS = [
    # Itens de venda → dependem de pdv_vendas
    ("pdv_venda_itens",
     "venda_id IN (SELECT id FROM pdv_vendas WHERE empresa_id = ANY('{35,37,39,40}'))"),

    # Transactional / financial
    ("baixas",
     "lancamento_id IN (SELECT id FROM lancamentos WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("anexos_lancamento",
     "lancamento_id IN (SELECT id FROM lancamentos WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("alertas_anomalia",     "empresa_id = ANY('{35,37,39,40}')"),
    ("audit_logs",           "empresa_id = ANY('{35,37,39,40}')"),
    ("lancamentos",          "empresa_id = ANY('{35,37,39,40}')"),
    ("pdv_movimentacoes",    "empresa_id = ANY('{35,37,39,40}')"),
    ("pdv_ifood_lancamentos","empresa_id = ANY('{35,37,39,40}')"),
    ("pdv_vendas",           "empresa_id = ANY('{35,37,39,40}')"),

    # Cards / conciliation
    ("lote_cartao_itens",
     "lote_cartao_id IN (SELECT id FROM lotes_cartao WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("lotes_cartao",         "empresa_id = ANY('{35,37,39,40}')"),

    # Integrations
    ("mapeamentos_categoria",
     "integracao_id IN (SELECT id FROM integracoes_bancarias WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("integracoes_bancarias","empresa_id = ANY('{35,37,39,40}')"),

    # Master data (recreated by importer)
    ("regras_cartao",        "empresa_id = ANY('{35,37,39,40}')"),
    ("regras_comissao",      "empresa_id = ANY('{35,37,39,40}')"),
    ("metas_vendedores",     "empresa_id = ANY('{35,37,39,40}')"),
    ("orcamentos",           "empresa_id = ANY('{35,37,39,40}')"),
    ("movimentos",           "empresa_id = ANY('{35,37,39,40}')"),
    ("movimentacoes_estoque","empresa_id = ANY('{35,37,39,40}')"),
    ("fornecedor_produto_equivalencias",
     "produto_id IN (SELECT id FROM produtos WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("produtos",             "empresa_id = ANY('{35,37,39,40}')"),
    ("entidades",            "empresa_id = ANY('{35,37,39,40}')"),
    ("dashboard_view_configs","empresa_id = ANY('{35,37,39,40}')"),
    ("plano_contas_template_configs", "empresa_id = ANY('{35,37,39,40}')"),
    ("plano_contas",         "empresa_id = ANY('{35,37,39,40}')"),
    ("centros_custo",        "empresa_id = ANY('{35,37,39,40}')"),

    # Contas bancárias (depois de lancamentos)
    ("usuario_conta_acesso",
     "conta_id IN (SELECT id FROM contas WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("contas",               "empresa_id = ANY('{35,37,39,40}')"),

    # Operator users (non-consultants only — preserva consultores)
    ("user_company_profiles",
     "empresa_id = ANY('{35,37,39,40}') AND usuario_id IN "
     "(SELECT id FROM usuarios WHERE empresa_id = ANY('{35,37,39,40}') AND is_consultor = FALSE)"),
    ("access_profile_permissions",
     "profile_id IN (SELECT id FROM access_profiles WHERE empresa_id = ANY('{35,37,39,40}'))"),
    ("access_profiles",      "empresa_id = ANY('{35,37,39,40}')"),
    ("usuarios",
     "empresa_id = ANY('{35,37,39,40}') AND is_consultor = FALSE"),
]

def main():
    mode = "[DRY RUN]" if DRY_RUN else "[EXECUCAO REAL]"
    print("=" * 60)
    print(f"WIPE PIZZA FABIO {mode}")
    print(f"Empresas: {EMPRESA_IDS}")
    print("=" * 60)

    # --- Show counts (read-only connection) ---
    print("\nContagem atual:")
    key_tables = [
        ("lancamentos",       "empresa_id = ANY('{35,37,39,40}')"),
        ("pdv_vendas",        "empresa_id = ANY('{35,37,39,40}')"),
        ("pdv_movimentacoes", "empresa_id = ANY('{35,37,39,40}')"),
        ("contas",            "empresa_id = ANY('{35,37,39,40}')"),
        ("plano_contas",      "empresa_id = ANY('{35,37,39,40}')"),
        ("entidades",         "empresa_id = ANY('{35,37,39,40}')"),
        ("usuarios",          "empresa_id = ANY('{35,37,39,40}') AND is_consultor = FALSE"),
    ]
    total = 0
    with engine.connect() as conn:
        for table, where in key_tables:
            try:
                result = conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE {where}"))
                count = result.scalar()
                print(f"  {table}: {count:,}")
                total += count
            except Exception as e:
                print(f"  {table}: ERRO - {e}")
    print(f"\n  TOTAL estimado: {total:,} registros")

    if DRY_RUN:
        print("\n[DRY RUN] Nenhuma alteracao feita.")
        print("Rode sem --dry-run para executar.")
        return

    confirm = input("\nDigite SIM para confirmar a exclusao: ")
    if confirm.strip().upper() != "SIM":
        print("Cancelado.")
        return

    # --- EXECUTE in a single transaction via engine.begin() ---
    print("\nExecutando delecoes...")
    import time
    t0 = time.time()
    try:
        with engine.begin() as conn:
            # Desabilita verificacao de FK durante o delete - muito mais rapido
            # Seguro pois mantemos a ordem manual e eh tudo na mesma transacao
            conn.execute(text("SET session_replication_role = replica"))

            for table, where in DELETIONS:
                try:
                    sql = f"DELETE FROM {table} WHERE {where}"
                    result = conn.execute(text(sql))
                    if result.rowcount > 0:
                        print(f"  [{result.rowcount:>7,}] {table}")
                except Exception as e:
                    err_msg = str(e)
                    # Ignora tabelas inexistentes (podem nao ter dados no sistema)
                    if "does not exist" in err_msg or "UndefinedTable" in err_msg:
                        print(f"  [SKIP] {table}: tabela nao existe no banco")
                    else:
                        print(f"  [ERRO] {table}: {e}")
                        raise  # re-raise only for real errors

            # Restaura verificacao de FK
            conn.execute(text("SET session_replication_role = DEFAULT"))

        elapsed = time.time() - t0
        print(f"\n[OK] Limpeza concluida em {elapsed:.1f}s!")
        print("\nProximos passos:")
        print("  1. docker compose exec backend python scripts/run_production_import.py")
        print("  2. docker compose exec backend python scripts/create_operators.py")

    except Exception as e:
        print(f"\n[ERRO CRITICO] Rollback executado: {e}")
        raise


if __name__ == "__main__":
    main()

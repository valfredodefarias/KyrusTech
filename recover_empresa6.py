"""
SCRIPT DE RECUPERAÇÃO DE DADOS - Empresa 6 (Pinheiros Farmacia de Manipulação)
Recupera dados apagados via 'zona crítica' usando o audit_log.

USO:
  python recover_empresa6.py --dry-run    # apenas mostra o que seria recuperado
  python recover_empresa6.py --execute    # executa a recuperação real

IMPORTANTE: Faça um pg_dump antes de executar!
  pg_dump -h 103.63.28.155 -U casaos -d casaos > backup_antes_recovery.sql
"""

import sys
import argparse
import psycopg2
import psycopg2.extras
from datetime import datetime, date
from decimal import Decimal

EMPRESA_ID = 6
DB_CONFIG = dict(host='103.63.28.155', port=5432, user='casaos', password='casaos', dbname='casaos', connect_timeout=20)

# Defaults para colunas NOT NULL que podem não existir em registros antigos no audit_log
COLUMN_DEFAULTS = {
    'contas':       {'conta_como_disponibilidade': True},
    'lancamentos':  {'ipp': False, 'previsto': False, 'conciliado': False},
    'entidades':    {'is_deleted': False},
    'centros_custo': {'is_deleted': False},
    'plano_contas': {
        'is_deleted': False,
        'eh_cabecalho': False,
        'eh_divida': False,
        'permite_lancamentos': True,
        'eh_operacional': True,
        'considerar_nos_resultados': True,
        'oculta': False,
    },
}

def extract_new_values(changes: dict) -> dict:
    """Extrai valores 'new' de cada campo no dict de changes do audit_log."""
    result = {}
    for k, v in changes.items():
        if isinstance(v, dict) and 'new' in v:
            result[k] = v['new']
        elif not isinstance(v, dict):
            result[k] = v
    return result

def get_records_from_audit(cur, table_name, empresa_id):
    """
    Reconstrói o estado mais recente de cada registro para empresa_id
    a partir do audit_log (CREATE + UPDATEs aplicados em ordem temporal).
    Retorna: {record_id: {field: value}}
    """
    print(f"\n  Buscando audit_logs para tabela '{table_name}', empresa {empresa_id}...")

    # Passo 1: obter todos os record_ids criados para esta empresa
    cur.execute("""
        SELECT DISTINCT record_id FROM audit_logs
        WHERE table_name = %s AND action = 'CREATE'
        AND changes->'empresa_id'->>'new' = %s
        ORDER BY record_id
    """, (table_name, str(empresa_id)))
    record_ids = [r[0] for r in cur.fetchall()]
    print(f"  {len(record_ids)} registros encontrados no audit_log para '{table_name}'")

    if not record_ids:
        return {}

    # Passo 2: buscar TODOS os eventos para esses record_ids em lote
    cur.execute("""
        SELECT record_id, action, changes, created_at, id
        FROM audit_logs
        WHERE table_name = %s AND record_id = ANY(%s)
        ORDER BY record_id, created_at ASC, id ASC
    """, (table_name, record_ids))
    all_entries = cur.fetchall()

    # Passo 3: agrupar e construir estado final por record_id
    from collections import defaultdict
    by_record = defaultdict(list)
    for rid, action, changes, ts, audit_id in all_entries:
        by_record[rid].append((action, changes, ts))

    result = {}
    for rid in record_ids:
        state = {}
        first_ts = None
        for action, changes, ts in by_record.get(rid, []):
            if first_ts is None:
                first_ts = ts
            if not changes:
                continue
            new_vals = extract_new_values(changes)
            state.update(new_vals)
        if state:
            state['id'] = rid
            # Preencher created_at / updated_at com timestamp do audit_log se NULL
            if not state.get('created_at') and first_ts:
                state['created_at'] = first_ts
            if not state.get('updated_at') and first_ts:
                state['updated_at'] = first_ts
            # Aplicar defaults para colunas NOT NULL ausentes no audit_log antigo
            for col, default_val in COLUMN_DEFAULTS.get(table_name, {}).items():
                if state.get(col) is None:
                    state[col] = default_val
            result[rid] = state

    return result

def cast_value(v):
    """Converte string → tipo Python correto para psycopg2."""
    if v is None:
        return None
    if isinstance(v, (int, float, bool)):
        return v
    if isinstance(v, str):
        # Tenta bool
        if v.lower() == 'true': return True
        if v.lower() == 'false': return False
        # Tenta data (YYYY-MM-DD)
        if len(v) == 10 and v[4] == '-' and v[7] == '-':
            try: return date.fromisoformat(v)
            except: pass
        # Tenta datetime
        if 'T' in v or (len(v) > 10 and v[10] == ' '):
            try: return datetime.fromisoformat(v.replace('T', ' ').split('.')[0])
            except: pass
        # Tenta decimal
        try: return Decimal(v)
        except: pass
    return v

def build_insert(table_name, record: dict, columns: list) -> tuple[str, list]:
    """
    Monta INSERT OR IGNORE para o registro, usando apenas colunas conhecidas.
    Retorna (sql, values).
    """
    cols = [c for c in columns if c in record]
    vals = [cast_value(record.get(c)) for c in cols]
    placeholders = ', '.join(['%s'] * len(cols))
    col_str = ', '.join(cols)
    sql = f"INSERT INTO {table_name} ({col_str}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING"
    return sql, vals

def get_table_columns(cur, table_name):
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s ORDER BY ordinal_position
    """, (table_name,))
    return [r[0] for r in cur.fetchall()]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Apenas mostra o que seria recuperado')
    parser.add_argument('--execute', action='store_true', help='Executa a recuperação no banco')
    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        print("Use --dry-run ou --execute")
        sys.exit(1)

    dry_run = args.dry_run
    mode = "DRY-RUN" if dry_run else "EXECUÇÃO REAL"
    print(f"\n{'='*60}")
    print(f"RECUPERAÇÃO DE DADOS - Empresa {EMPRESA_ID}")
    print(f"MODO: {mode}")
    print(f"{'='*60}")

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # ===== COLETA DE DADOS DO AUDIT LOG =====
    tabelas_a_recuperar = [
        ('centros_custo',   'centros_custo'),
        ('entidades',       'entidades'),
        ('contas',          'contas'),
        ('cartoes',         'cartoes'),
        ('plano_contas',    'plano_contas'),
        ('lancamentos',     'lancamentos'),
    ]

    dados_recuperados = {}
    total_geral = 0
    for audit_table_name, db_table_name in tabelas_a_recuperar:
        records = get_records_from_audit(cur, audit_table_name, EMPRESA_ID)
        dados_recuperados[db_table_name] = records
        total_geral += len(records)

    print(f"\n{'='*60}")
    print("RESUMO DO QUE SERÁ RECUPERADO:")
    for db_table, records in dados_recuperados.items():
        # Filtrar registros que já existem no banco agora
        placeholders = ','.join(['%s'] * len(records)) if records else '0'
        if records:
            cur.execute(f"SELECT id FROM {db_table} WHERE id = ANY(%s) AND empresa_id = %s",
                       (list(records.keys()), EMPRESA_ID))
            existing = {r[0] for r in cur.fetchall()}
            novos = len(records) - len(existing)
        else:
            existing = set()
            novos = 0
        print(f"  {db_table:25s}: {len(records):6d} no audit_log | {novos:6d} a restaurar | {len(existing):4d} já existem")
    print(f"  {'TOTAL':25s}: {total_geral:6d} registros")
    print(f"{'='*60}")

    if dry_run:
        print("\nDRY-RUN concluído. Use --execute para recuperar.")
        cur.close()
        conn.close()
        return

    # ===== EXECUÇÃO REAL (fases com commits incrementais) =====
    print("\nIniciando recuperação por fases com commits incrementais...")

    def insert_records_batch(conn, cur, db_table_name, records, columns):
        """Insere registros em lotes de 200 usando execute_values."""
        if not records:
            return 0

        # Determinar colunas comuns a todos os registros
        all_keys = set()
        for r in records.values():
            all_keys.update(r.keys())
        use_cols = [c for c in columns if c in all_keys]

        rows = []
        for rid, record in records.items():
            row = tuple(cast_value(record.get(c)) for c in use_cols)
            rows.append(row)

        col_str = ', '.join(use_cols)
        placeholders = ', '.join(['%s'] * len(use_cols))
        sql = f"INSERT INTO {db_table_name} ({col_str}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING"

        inserted = 0
        BATCH = 200
        for i in range(0, len(rows), BATCH):
            batch = rows[i:i+BATCH]
            psycopg2.extras.execute_batch(cur, sql, batch, page_size=200)
            inserted += len(batch)
            if len(rows) > 500:
                pct = int((i + len(batch)) / len(rows) * 100)
                print(f"    {db_table_name}: {i+len(batch)}/{len(rows)} ({pct}%)", end='\r')
        if len(rows) > 500:
            print()
        return inserted

    try:
        # FASE 1: limpar seeds e inserir tabelas de referência (pequenas)
        print("\n--- FASE 1: Limpando seeds e restaurando tabelas de referência ---")
        cur.execute("SET session_replication_role = replica")

        # Limpar seeds do reset SE ainda existirem (script pode ser reexecutado)
        cur.execute("DELETE FROM plano_contas WHERE empresa_id = %s AND created_at > NOW() - INTERVAL '2 hours' "
                    "AND id NOT IN (SELECT DISTINCT record_id FROM audit_logs WHERE table_name='plano_contas' "
                    "AND changes->'empresa_id'->>'new' = %s)", (EMPRESA_ID, str(EMPRESA_ID)))
        if cur.rowcount:
            print(f"  Removidos {cur.rowcount} plano_contas seed (pós-reset)")
        cur.execute("DELETE FROM centros_custo WHERE empresa_id = %s AND created_at > NOW() - INTERVAL '2 hours' "
                    "AND id NOT IN (SELECT DISTINCT record_id FROM audit_logs WHERE table_name='centros_custo' "
                    "AND changes->'empresa_id'->>'new' = %s)", (EMPRESA_ID, str(EMPRESA_ID)))
        if cur.rowcount:
            print(f"  Removidos {cur.rowcount} centros_custo seed (pós-reset)")

        for _, db_table in [('centros_custo', 'centros_custo'), ('contas', 'contas'),
                             ('plano_contas', 'plano_contas')]:
            rec = dados_recuperados[db_table]
            if not rec:
                continue
            cols = get_table_columns(cur, db_table)
            n = insert_records_batch(conn, cur, db_table, rec, cols)
            print(f"  {db_table}: {n} registros inseridos")

        cur.execute("SET session_replication_role = DEFAULT")
        conn.commit()
        print("  FASE 1 commitada ✓")

        # FASE 2: entidades
        print("\n--- FASE 2: Restaurando entidades ---")
        cur.execute("SET session_replication_role = replica")
        rec = dados_recuperados['entidades']
        if rec:
            cols = get_table_columns(cur, 'entidades')
            n = insert_records_batch(conn, cur, 'entidades', rec, cols)
            print(f"  entidades: {n} registros inseridos")
        cur.execute("SET session_replication_role = DEFAULT")
        conn.commit()
        print("  FASE 2 commitada ✓")

        # FASE 3: lancamentos
        print("\n--- FASE 3: Restaurando lancamentos ---")
        cur.execute("SET session_replication_role = replica")
        rec = dados_recuperados['lancamentos']
        if rec:
            cols = get_table_columns(cur, 'lancamentos')
            n = insert_records_batch(conn, cur, 'lancamentos', rec, cols)
            print(f"  lancamentos: {n} registros inseridos")
        cur.execute("SET session_replication_role = DEFAULT")
        conn.commit()
        print("  FASE 3 commitada ✓")

        # FASE 4: atualizar sequências
        print("\n--- FASE 4: Atualizando sequências ---")
        for _, db_table in tabelas_a_recuperar:
            try:
                cur.execute(f"""
                    SELECT setval(pg_get_serial_sequence('{db_table}', 'id'),
                                  COALESCE((SELECT MAX(id) FROM {db_table}), 1))
                """)
                print(f"  Sequência {db_table}: {cur.fetchone()[0]}")
            except Exception as e:
                print(f"  Aviso sequência {db_table}: {e}")
        conn.commit()

        print(f"\n{'='*60}")
        print("RECUPERACAO CONCLUIDA COM SUCESSO!")
        print(f"{'='*60}")

        # Verificação final
        cur.execute("""SELECT
            (SELECT COUNT(*) FROM lancamentos WHERE empresa_id=%s),
            (SELECT COUNT(*) FROM plano_contas WHERE empresa_id=%s),
            (SELECT COUNT(*) FROM entidades WHERE empresa_id=%s),
            (SELECT COUNT(*) FROM centros_custo WHERE empresa_id=%s),
            (SELECT COUNT(*) FROM contas WHERE empresa_id=%s)
        """, (EMPRESA_ID,)*5)
        r = cur.fetchone()
        print(f"  lancamentos={r[0]} | plano_contas={r[1]} | entidades={r[2]} | centros_custo={r[3]} | contas={r[4]}")

    except Exception as e:
        conn.rollback()
        print(f"\n ERRO durante recuperação: {e}")
        import traceback; traceback.print_exc()
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    main()

"""
Script de diagnóstico e recuperação de dados apagados via zona crítica.
Conecta ao banco de produção e verifica o que pode ser recuperado.
"""
import psycopg2
import json
from datetime import datetime

conn = psycopg2.connect(
    host='103.63.28.155', port=5432,
    user='casaos', password='casaos', dbname='casaos', connect_timeout=15
)
cur = conn.cursor()

print("=" * 60)
print("=== EMPRESAS ATIVAS ===")
cur.execute("SELECT id, nome_fantasia, razao_social, created_at FROM empresas WHERE is_deleted = false ORDER BY id")
for r in cur.fetchall():
    print(r)

print("\n=== CONTAGEM ATUAL DE DADOS POR EMPRESA ===")
cur.execute("""
    SELECT e.id, e.nome_fantasia,
        (SELECT COUNT(*) FROM lancamentos l WHERE l.empresa_id = e.id) AS lancamentos,
        (SELECT COUNT(*) FROM plano_contas pc WHERE pc.empresa_id = e.id) AS plano_contas,
        (SELECT COUNT(*) FROM entidades en WHERE en.empresa_id = e.id) AS entidades,
        (SELECT COUNT(*) FROM centro_custo cc WHERE cc.empresa_id = e.id) AS centro_custo
    FROM empresas e WHERE e.is_deleted = false ORDER BY e.id
""")
for r in cur.fetchall():
    print(r)

print("\n=== TOTAL DE REGISTROS NOS AUDIT LOGS ===")
cur.execute("SELECT COUNT(*) FROM audit_logs")
print("Total:", cur.fetchone()[0])

print("\n=== AUDIT LOGS POR TABELA E AÇÃO ===")
cur.execute("SELECT table_name, action, COUNT(*) FROM audit_logs GROUP BY table_name, action ORDER BY table_name, action")
for r in cur.fetchall():
    print(r)

print("\n=== ÚLTIMAS 10 ENTRADAS DO AUDIT LOG ===")
cur.execute("SELECT id, table_name, record_id, action, user_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10")
for r in cur.fetchall():
    print(r)

print("\n=== CONFIGURAÇÃO WAL DO POSTGRESQL ===")
cur.execute("SHOW wal_level")
print("wal_level:", cur.fetchone()[0])
cur.execute("SHOW archive_mode")
print("archive_mode:", cur.fetchone()[0])

cur.close()
conn.close()
print("\nDiagnóstico concluído.")

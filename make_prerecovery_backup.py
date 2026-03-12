"""Backup rápido do estado atual da empresa 6 antes da recuperação."""
import psycopg2
conn = psycopg2.connect(host='103.63.28.155', port=5432, user='casaos', password='casaos', dbname='casaos', connect_timeout=15)
cur = conn.cursor()

lines = ["-- Backup estado atual empresa 6 antes da recuperação\n-- Gerado em: " + str(__import__('datetime').datetime.now()) + "\n"]

for table in ['plano_contas', 'centros_custo']:
    cur.execute(f'SELECT * FROM {table} WHERE empresa_id = 6')
    rows = cur.fetchall()
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name=%s ORDER BY ordinal_position", (table,))
    cols = [r[0] for r in cur.fetchall()]
    lines.append(f"-- {table}: {len(rows)} registros")
    for row in rows:
        vals = []
        for v in row:
            if v is None:
                vals.append('NULL')
            elif isinstance(v, bool):
                vals.append('TRUE' if v else 'FALSE')
            elif isinstance(v, str):
                vals.append("'" + v.replace("'", "''") + "'")
            else:
                vals.append(str(v))
        lines.append(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join(vals)}) ON CONFLICT DO NOTHING;")
    lines.append("")

with open('backup_prerecovery_empresa6.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("Backup salvo em backup_prerecovery_empresa6.sql")
cur.close()
conn.close()

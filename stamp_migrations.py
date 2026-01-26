import psycopg2

conn = psycopg2.connect('postgresql://casaos:casaos@103.63.28.155:5432/casaos')
cur = conn.cursor()

# Check if they already exist
cur.execute("SELECT version_num FROM alembic_version WHERE version_num IN ('consultor_empresa_001', 'usuario_consultor_role_001')")
existing = [row[0] for row in cur.fetchall()]

# Insert missing ones
if 'consultor_empresa_001' not in existing:
    cur.execute("INSERT INTO alembic_version (version_num) VALUES ('consultor_empresa_001')")
if 'usuario_consultor_role_001' not in existing:
    cur.execute("INSERT INTO alembic_version (version_num) VALUES ('usuario_consultor_role_001')")

conn.commit()
cur.close()
conn.close()
print('Stamped migrations successfully')

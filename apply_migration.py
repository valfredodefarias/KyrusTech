import psycopg2

conn = psycopg2.connect('postgresql://casaos:casaos@103.63.28.155:5432/casaos')
cur = conn.cursor()

# Stamp the new migration
cur.execute("INSERT INTO alembic_version (version_num) VALUES ('empresa_id_nullable_001')")
conn.commit()

# Apply it manually via SQL
cur.execute("ALTER TABLE usuarios ALTER COLUMN empresa_id DROP NOT NULL")
conn.commit()

cur.close()
conn.close()
print('Migration applied: empresa_id is now nullable')

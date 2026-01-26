import psycopg2

conn = psycopg2.connect('postgresql://casaos:casaos@103.63.28.155:5432/casaos')
cur = conn.cursor()

cur.execute("SELECT id, email, is_consultor, consultor_role FROM usuarios LIMIT 10")
for row in cur.fetchall():
    print(f"ID={row[0]}, Email={row[1]}, is_consultor={row[2]}, consultor_role={row[3]}")

cur.close()
conn.close()

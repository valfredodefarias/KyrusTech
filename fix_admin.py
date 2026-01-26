import psycopg2

conn = psycopg2.connect('postgresql://casaos:casaos@103.63.28.155:5432/casaos')
cur = conn.cursor()

# Update admin user
cur.execute("""
UPDATE usuarios 
SET email = 'admin@kyrustech.com', consultor_role = 'SUPER_CONSULTOR'
WHERE id = 1
""")

conn.commit()

# Verify
cur.execute("SELECT id, email, is_consultor, consultor_role FROM usuarios WHERE id = 1")
admin = cur.fetchone()
if admin:
	print(f"Admin updated: ID={admin[0]}, Email={admin[1]}, is_consultor={admin[2]}, consultor_role={admin[3]}")
else:
	print("Nenhum usuário admin encontrado para verificar.")

cur.close()
conn.close()

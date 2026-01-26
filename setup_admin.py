import psycopg2

conn = psycopg2.connect('postgresql://casaos:casaos@103.63.28.155:5432/casaos')
cur = conn.cursor()

# Check admin user
cur.execute("SELECT id, email, is_consultor, consultor_role FROM usuarios WHERE email = 'admin@kyrustech.com'")
admin = cur.fetchone()

if admin:
    print(f"Admin found: ID={admin[0]}, Email={admin[1]}, is_consultor={admin[2]}, consultor_role={admin[3]}")
    
    # If not set correctly, update
    if admin[2] is not True or admin[3] != 'SUPER_CONSULTOR':
        cur.execute("""
        UPDATE usuarios 
        SET is_consultor = true, consultor_role = 'SUPER_CONSULTOR'
        WHERE email = 'admin@kyrustech.com'
        """)
        conn.commit()
        print("Updated admin to SUPER_CONSULTOR")
else:
    print("Admin user not found")

# Also check if admin is linked to the KyrusTech empresa
cur.execute("""
SELECT ce.id FROM consultor_empresa ce
JOIN usuarios u ON u.id = ce.usuario_id
JOIN empresas e ON e.id = ce.empresa_id
WHERE u.email = 'admin@kyrustech.com' AND e.nome_fantasia = 'KyrusTech'
""")

if not cur.fetchone():
    # Need to add
    cur.execute("""
    INSERT INTO consultor_empresa (usuario_id, empresa_id, ativo)
    SELECT u.id, e.id, true
    FROM usuarios u, empresas e
    WHERE u.email = 'admin@kyrustech.com' AND e.nome_fantasia = 'KyrusTech'
    """)
    conn.commit()
    print("Linked admin to KyrusTech empresa")
else:
    print("Admin already linked to KyrusTech")

cur.close()
conn.close()

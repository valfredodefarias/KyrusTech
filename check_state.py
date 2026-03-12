import psycopg2
conn = psycopg2.connect(host='103.63.28.155', port=5432, user='casaos', password='casaos', dbname='casaos', connect_timeout=15)
cur = conn.cursor()
cur.execute("""
    SELECT 
        (SELECT COUNT(*) FROM lancamentos WHERE empresa_id=6) AS lanc,
        (SELECT COUNT(*) FROM plano_contas WHERE empresa_id=6) AS plano,
        (SELECT COUNT(*) FROM entidades WHERE empresa_id=6) AS ent,
        (SELECT COUNT(*) FROM centros_custo WHERE empresa_id=6) AS cc,
        (SELECT COUNT(*) FROM contas WHERE empresa_id=6) AS contas
""")
row = cur.fetchone()
print(f"lancamentos={row[0]} | plano_contas={row[1]} | entidades={row[2]} | centros_custo={row[3]} | contas={row[4]}")
conn.close()

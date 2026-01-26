import psycopg2

conn = psycopg2.connect('postgresql://casaos:casaos@103.63.28.155:5432/casaos')
cur = conn.cursor()

# Check if column already exists
cur.execute("""
SELECT column_name FROM information_schema.columns 
WHERE table_name='usuarios' AND column_name='consultor_role'
""")

if cur.fetchone() is None:
    # Add column if it doesn't exist
    cur.execute("""
    ALTER TABLE usuarios ADD COLUMN consultor_role VARCHAR DEFAULT 'USUARIO_NORMAL' NOT NULL
    """)
    conn.commit()
    print('Added consultor_role column')
else:
    print('consultor_role column already exists')

cur.close()
conn.close()

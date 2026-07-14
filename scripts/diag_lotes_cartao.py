"""Diagnóstico: verifica lotes_cartao no banco para empresa Umarizal"""
import sys, os
sys.path.insert(0, "/app")
from sqlalchemy import text
from app.db.session import engine

with engine.connect() as conn:
    # 1. Conta lotes por empresa
    rows = conn.execute(text("""
        SELECT empresa_id, COUNT(*) as qtd, SUM(valor_bruto) as total_bruto,
               MIN(data_pagamento) as min_dt, MAX(data_pagamento) as max_dt
        FROM lotes_cartao
        GROUP BY empresa_id ORDER BY empresa_id
    """)).all()
    print("=== lotes_cartao por empresa ===")
    for r in rows:
        print(f"  empresa_id={r[0]}: {r[1]:,} lotes | bruto={r[2]:,.2f} | {r[3]} → {r[4]}")

    # 2. Amostra de lotes da Umarizal (empresa_id=35)
    rows2 = conn.execute(text("""
        SELECT id, data_pagamento, valor_bruto, valor_taxa, valor_liquido,
               status, conta_destino_id
        FROM lotes_cartao
        WHERE empresa_id = 35
        ORDER BY data_pagamento DESC
        LIMIT 5
    """)).all()
    print("\n=== Últimos 5 lotes Umarizal (empresa 35) ===")
    for r in rows2:
        print(f"  id={r[0]} | dt={r[1]} | bruto={r[2]} | taxa={r[3]} | liq={r[4]} | status={r[5]} | conta={r[6]}")

    # 3. Checa se a tabela tem coluna bandeira (pode ser necessária no frontend)
    cols = conn.execute(text("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'lotes_cartao'
        ORDER BY ordinal_position
    """)).all()
    print("\n=== Colunas de lotes_cartao ===")
    for c in cols:
        print(f"  {c[0]}: {c[1]}")

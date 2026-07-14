"""Diagnóstico: por que /pdv/recebiveis retorna vazio pra Umarizal?"""
import sys, json
sys.path.insert(0, "/app")
from sqlalchemy import text
from app.db.session import engine

with engine.connect() as conn:
    # 1. Conta Lancamentos PDV por tipo em Umarizal
    rows = conn.execute(text("""
        SELECT
            l.status,
            l.origem,
            CASE
                WHEN l.observacao IS NULL THEN 'sem observacao'
                WHEN l.observacao::text ILIKE '%cartao_credito_vista%' THEN 'cartao_credito_vista'
                WHEN l.observacao::text ILIKE '%cartao_debito%' THEN 'cartao_debito'
                WHEN l.observacao::text ILIKE '%cartao_credito_parcelado%' THEN 'cartao_credito_parcelado'
                WHEN l.observacao::text ILIKE '%dinheiro%' THEN 'dinheiro'
                WHEN l.observacao::text ILIKE '%pix%' THEN 'pix'
                WHEN l.observacao::text ILIKE '%ifood%' THEN 'ifood'
                ELSE 'outro'
            END as tipo_obs,
            COUNT(*) as qtd,
            MIN(l.data_vencimento) as min_dt,
            MAX(l.data_vencimento) as max_dt
        FROM lancamentos l
        WHERE l.empresa_id = 35
          AND l.is_deleted = false
          AND l.tipo = 'RECEITA'
          AND l.origem = 'PDV'
        GROUP BY l.status, l.origem, tipo_obs
        ORDER BY qtd DESC
    """)).all()
    
    print("=== Lancamentos PDV RECEITA Umarizal (empresa 35) ===")
    for r in rows:
        print(f"  status={r[0]:10s} | tipo={r[2]:30s} | qtd={r[3]:>6,} | {r[4]} → {r[5]}")

    # 2. Amostra do campo observacao de lancamentos cartao
    print()
    print("=== Amostra observacao de lancamento cartao ===")
    rows2 = conn.execute(text("""
        SELECT l.id, l.data_vencimento, l.status, l.observacao
        FROM lancamentos l
        WHERE l.empresa_id = 35
          AND l.is_deleted = false
          AND l.tipo = 'RECEITA'
          AND l.origem = 'PDV'
          AND l.observacao IS NOT NULL
          AND l.observacao::text ILIKE '%cartao%'
        LIMIT 3
    """)).all()
    for r in rows2:
        obs = json.loads(r[3]) if r[3] else {}
        print(f"  id={r[0]} | venc={r[1]} | status={r[2]}")
        print(f"    tipo_pagamento={obs.get('tipo_pagamento')} | bandeira={obs.get('bandeira')}")
        print(f"    cartao_taxa={obs.get('cartao_taxa')} | cartao_liquido={obs.get('cartao_liquido_previsto')}")
        print(f"    legacy_id_venda={obs.get('legacy_id_venda')} | rv={obs.get('rv')}")
        
    # 3. Range de datas dos lancamentos PDV cartao
    print()
    print("=== Range datas lancamentos PDV cartao ===")
    r3 = conn.execute(text("""
        SELECT MIN(data_vencimento), MAX(data_vencimento), COUNT(*)
        FROM lancamentos
        WHERE empresa_id = 35
          AND is_deleted = false
          AND tipo = 'RECEITA'
          AND origem = 'PDV'
          AND observacao::text ILIKE '%cartao%'
    """)).first()
    print(f"  Min={r3[0]} | Max={r3[1]} | Total={r3[2]:,}")

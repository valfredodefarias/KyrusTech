"""Diagnóstico: iFood e conciliação em todas as empresas"""
import sys, json
sys.path.insert(0, "/app")
from sqlalchemy import text
from app.db.session import engine

with engine.connect() as conn:
    # 1. Que tipo_pagamento/bandeira fica nos lancamentos iFood PDV?
    print("=== Lancamentos PDV com bandeira IFOOD (todas empresas) ===")
    rows = conn.execute(text("""
        SELECT 
            empresa_id,
            status,
            COUNT(*) as qtd,
            MIN(data_vencimento) as min_dt,
            MAX(data_vencimento) as max_dt,
            (SELECT observacao FROM lancamentos l2 
             WHERE l2.empresa_id = l.empresa_id AND l2.origem = 'PDV'
               AND l2.observacao::text ILIKE '%ifood%'
               AND l2.is_deleted = false
             LIMIT 1) as sample_obs
        FROM lancamentos l
        WHERE is_deleted = false
          AND tipo = 'RECEITA'
          AND origem = 'PDV'
          AND observacao::text ILIKE '%ifood%'
        GROUP BY empresa_id, status
        ORDER BY empresa_id
    """)).all()
    for r in rows:
        obs = json.loads(r[5]) if r[5] else {}
        print(f"  empresa={r[0]} | status={r[1]} | qtd={r[2]:,} | {r[3]}→{r[4]}")
        print(f"    tipo_pagamento={obs.get('tipo_pagamento')} | bandeira={obs.get('bandeira')}")

    # 2. Lancamentos PDV conciliados (status PAGO) por empresa
    print()
    print("=== Lancamentos PDV PAGO (conciliados) por empresa ===")
    rows2 = conn.execute(text("""
        SELECT empresa_id, COUNT(*) as qtd, MIN(data_vencimento), MAX(data_vencimento)
        FROM lancamentos
        WHERE is_deleted = false AND tipo = 'RECEITA' AND origem = 'PDV'
          AND status = 'PAGO'
          AND observacao::text ILIKE '%cartao%'
        GROUP BY empresa_id ORDER BY empresa_id
    """)).all()
    for r in rows2:
        print(f"  empresa={r[0]} | qtd={r[1]:,} | {r[2]}→{r[3]}")

    # 3. Lotes com lancamento_deposito_id preenchido (já conciliados via Kyrus)
    print()
    print("=== LoteCartao com lancamento_deposito_id (conciliados via Kyrus) ===")
    rows3 = conn.execute(text("""
        SELECT empresa_id, COUNT(*) as total, 
               SUM(CASE WHEN lancamento_deposito_id IS NOT NULL THEN 1 ELSE 0 END) as com_deposito,
               SUM(CASE WHEN lancamento_deposito_id IS NULL THEN 1 ELSE 0 END) as sem_deposito
        FROM lotes_cartao
        GROUP BY empresa_id ORDER BY empresa_id
    """)).all()
    for r in rows3:
        print(f"  empresa={r[0]} | total={r[1]:,} | com_deposito={r[2]:,} | sem_deposito={r[3]:,}")

    # 4. Checa se iFood lancamentos existem como PdvIfoodLancamento
    print()
    print("=== PdvIfoodLancamento por empresa ===")
    rows4 = conn.execute(text("""
        SELECT empresa_id, COUNT(*) as qtd, 
               SUM(CASE WHEN status_conciliado THEN 1 ELSE 0 END) as conciliados
        FROM pdv_ifood_lancamentos
        GROUP BY empresa_id ORDER BY empresa_id
    """)).all()
    for r in rows4:
        print(f"  empresa={r[0]} | total={r[1]:,} | conciliados={r[2]:,}")

import psycopg2
import csv
import os

try:
    conn = psycopg2.connect("dbname=kyrus_temp user=kyrus_user password=kyrus_pass host=db_kyrustech port=5432")
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT l.id, l.data_vencimento, l.data_pagamento, l.descricao, l.valor_previsto, l.tipo, c.nome, pc.nome, cc.nome, e.nome
        FROM lancamentos l
        LEFT JOIN contas c ON l.conta_id = c.id
        LEFT JOIN plano_contas pc ON l.plano_contas_id = pc.id
        LEFT JOIN centros_custo cc ON l.centro_custo_id = cc.id
        LEFT JOIN entidades e ON l.entidade_id = e.id
        WHERE l.empresa_id = 27 
          AND l.conta_id = 215 
          AND l.is_deleted = false
          AND EXTRACT(MONTH FROM l.data_vencimento) = 7
          AND EXTRACT(YEAR FROM l.data_vencimento) = 2026
    """)
    rows = cur.fetchall()
    print(f"Total rows fetched: {len(rows)}")
    
    out_path = '/tmp/Lancamentos_RMUSIC_Julho.csv'
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow(["DATA VENCIMENTO", "DATA PAGAMENTO", "DESCRIÇÃO", "VALOR", "TIPO", "CONTA", "CATEGORIA", "CENTRO DE CUSTO", "ENTIDADE"])
        for row in rows:
            # format dates
            dt_v = row[1].strftime('%d/%m/%Y') if row[1] else ''
            dt_p = row[2].strftime('%d/%m/%Y') if row[2] else ''
            # format valor
            val = f"{row[4]:.2f}".replace('.', ',') if row[4] else '0,00'
            writer.writerow([dt_v, dt_p, row[3], val, row[5], row[6], row[7], row[8], row[9]])
            
    print(f"✅ CSV Exportado com sucesso para {out_path}")
except Exception as e:
    print("Erro durante exportação:", e)

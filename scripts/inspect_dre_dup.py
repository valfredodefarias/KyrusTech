# scripts/inspect_dre_dup.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, select, or_, func, text
from decimal import Decimal
from datetime import date

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings
from app.models.lancamento import Lancamento
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.plano_contas import PlanoContas

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    # We will inspect Pizza Fábio Umarizal (we can search by name to get the correct company_id)
    with engine.connect() as conn:
        res = conn.execute(text("SELECT id, nome_fantasia FROM empresas WHERE nome_fantasia ILIKE '%Fábio%' OR nome_fantasia ILIKE '%Umarizal%'"))
        empresas = res.all()
        print("Empresas encontradas:", empresas)
        if not empresas:
            print("Nenhuma empresa encontrada.")
            return
        empresa_id = empresas[0][0]
        empresa_nome = empresas[0][1]
        print(f"Analisando DRE de: {empresa_nome} (ID: {empresa_id}) para Janeiro 2026")
        
        # 1. Check max_web_date
        max_web_res = conn.execute(text(
            "SELECT max(data_vencimento) FROM lancamentos WHERE empresa_id = :empresa_id AND origem = 'WEB' AND is_deleted = false"
        ), {"empresa_id": empresa_id})
        max_web_date = max_web_res.scalar()
        print("max_web_date (origem='WEB'):", max_web_date)
        
        # 2. Get Lancamentos in Jan 2026 contributing to Revenue (Receitas)
        # Category tipo = 'R'
        res_lan = conn.execute(text("""
            SELECT l.id, l.origem, l.valor_previsto, l.valor_pago, l.data_pagamento, l.data_competencia, l.data_vencimento, pc.codigo, pc.nome, l.observacao
            FROM lancamentos l
            JOIN plano_contas pc ON pc.id = l.plano_contas_id
            WHERE l.empresa_id = :empresa_id
              AND l.is_deleted = false
              AND pc.tipo = 'R'
              AND COALESCE(l.data_competencia, l.data_vencimento) >= '2026-01-01'
              AND COALESCE(l.data_competencia, l.data_vencimento) <= '2026-01-31'
              AND (l.observacao IS NULL OR (l.observacao NOT ILIKE '%DestinoCompra DEMONSTRACAO%' AND l.observacao NOT ILIKE '%"legacy_id_venda"%'))
              AND (l.import_hash IS NULL OR l.import_hash NOT ILIKE 'sangria-%')
        """), {"empresa_id": empresa_id}).all()
        
        print(f"\n--- LANCAMENTOS DE RECEITA EM JAN/2026 ({len(res_lan)} registros) ---")
        total_lan = Decimal("0.00")
        origens = {}
        for r in res_lan[:20]: # print first 20
            val = r[3] if (r[4] is not None or r[3] != 0) else r[2]
            print(f"  ID: {r[0]} | Origem: {r[1]} | Valor: {val} | Data: {r[5] or r[6]} | PC: {r[7]} - {r[8]} | Obs: {r[9][:50] if r[9] else ''}")
            total_lan += Decimal(str(val))
            origens[r[1]] = origens.get(r[1], Decimal("0.00")) + Decimal(str(val))
        
        if len(res_lan) > 20:
            print(f"  ... e mais {len(res_lan) - 20} registros")
            for r in res_lan[20:]:
                val = r[3] if (r[4] is not None or r[3] != 0) else r[2]
                total_lan += Decimal(str(val))
                origens[r[1]] = origens.get(r[1], Decimal("0.00")) + Decimal(str(val))
                
        print("Total Lancamentos:", total_lan)
        print("Subtotais por Origem nos Lancamentos:", origens)
        
        # 3. Get PdvMovimentacoes in Jan 2026
        res_mov = conn.execute(text("""
            SELECT pm.id, pm.data, pm.valor, pm.forma_pagamento, pm.descricao, pm.import_hash
            FROM pdv_movimentacoes pm
            WHERE pm.empresa_id = :empresa_id
              AND pm.is_deleted = false
              AND pm.tipo = 'ENTRADA'
              AND pm.forma_pagamento IN ('DEBITO', 'CREDITO_AVISTA', 'CREDITO_PARCELADO')
              AND pm.data >= '2026-01-01'
              AND pm.data <= '2026-01-31'
              AND pm.data > COALESCE(:max_web_date, '2000-01-01'::date)
        """), {"empresa_id": empresa_id, "max_web_date": max_web_date}).all()
        
        print(f"\n--- PDV MOVIMENTACOES DE RECEITA EM JAN/2026 ({len(res_mov)} registros) ---")
        total_mov = Decimal("0.00")
        for m in res_mov[:20]:
            print(f"  ID: {m[0]} | Data: {m[1]} | Valor: {m[2]} | FP: {m[3]} | Desc: {m[4]} | Hash: {m[5]}")
            total_mov += Decimal(str(m[2]))
        if len(res_mov) > 20:
            print(f"  ... e mais {len(res_mov) - 20} registros")
            for m in res_mov[20:]:
                total_mov += Decimal(str(m[2]))
        print("Total PdvMovimentacoes:", total_mov)

if __name__ == "__main__":
    main()

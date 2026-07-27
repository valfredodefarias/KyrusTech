# scripts/audit_cleanup_safety.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from decimal import Decimal
from datetime import date

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        # Get all companies
        companies = conn.execute(text("SELECT id, nome_fantasia FROM empresas WHERE is_active = true")).all()
        print("======================================================================")
        print("AUDITORIA DE SEGURANÇA E LIMPEZA DE DUPLICATAS DO PDV")
        print("======================================================================")
        print(f"Total de empresas ativas no sistema: {len(companies)}\n")
        
        for emp_id, emp_name in companies:
            print(f"--- EMPRESA ID {emp_id}: {emp_name} ---")
            
            # Check max web date
            max_web = conn.execute(text(
                "SELECT max(data_vencimento) FROM lancamentos WHERE empresa_id = :emp_id AND origem = 'WEB' AND is_deleted = false"
            ), {"emp_id": emp_id}).scalar()
            
            print(f"  Último lançamento WEB (planilha): {max_web}")
            
            if not max_web:
                print("  -> Esta empresa NÃO possui lançamentos de planilha (WEB). NENHUM LANÇAMENTO SERÁ REMOVIDO.\n")
                continue
                
            # Query candidate PDV launches prior to max_web
            candidates = conn.execute(text("""
                SELECT 
                    l.id, l.valor_previsto, l.valor_pago, l.status, l.conciliado, 
                    l.conta_id, c.nome as conta_nome, pc.codigo, pc.nome as pc_nome
                FROM lancamentos l
                LEFT JOIN contas c ON c.id = l.conta_id
                JOIN plano_contas pc ON pc.id = l.plano_contas_id
                WHERE l.empresa_id = :emp_id
                  AND l.is_deleted = false
                  AND l.origem = 'PDV'
                  AND COALESCE(l.data_competencia, l.data_vencimento) <= :max_web
                  AND (pc.codigo NOT IN ('01.01', '01.01.01') AND LOWER(pc.nome) NOT LIKE '%dinheiro%')
            """), {"emp_id": emp_id, "max_web": max_web}).all()
            
            print(f"  Lançamentos PDV elegíveis para limpeza (<= {max_web}): {len(candidates)}")
            
            if not candidates:
                print("  -> Nenhum lançamento duplicado encontrado.\n")
                continue
                
            total_val = sum(Decimal(str(r[2] or r[1] or 0)) for r in candidates)
            conciliados = [r for r in candidates if r[4] is True]
            pagos_banco = [r for r in candidates if r[3] == 'PAGO' and r[5] is not None and 'dinheiro' not in (r[6] or '').lower()]
            
            print(f"  Total em valor dos lançamentos elegíveis: R$ {total_val:,.2f}")
            print(f"  - Lançamentos Conciliados (conciliado=True): {len(conciliados)}")
            print(f"  - Lançamentos Pagos em Contas Bancárias Reais: {len(pagos_banco)}")
            
            # Check links to lote_cartao_itens
            cand_ids = tuple(r[0] for r in candidates)
            if cand_ids:
                # In normalized schema, check if pdv_movimentacao_id or lancamento_id link exists
                lote_links = conn.execute(text(
                    "SELECT count(*) FROM lote_cartao_itens WHERE pdv_movimentacao_id IN (SELECT id FROM pdv_movimentacoes WHERE venda_id IN (SELECT id_parcelamento FROM lancamentos WHERE id IN :ids))"
                ), {"ids": cand_ids}).scalar()
                print(f"  - Vinculados a Lotes de Cartão (lote_cartao_itens): {lote_links}")
                
            # Sample observacao JSONs
            sample_obs = conn.execute(text(
                "SELECT id, observacao FROM lancamentos WHERE id IN :ids LIMIT 5"
            ), {"ids": cand_ids[:5]}).all()
            print("  - Exemplos de observacao nos lançamentos do PDV:")
            for s_id, s_obs in sample_obs:
                print(f"    [ID {s_id}]: {s_obs}")
            print()

if __name__ == "__main__":
    main()

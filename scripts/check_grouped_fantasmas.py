import sys
import json
from pathlib import Path
from sqlalchemy import text
from decimal import Decimal

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from sqlmodel import Session

def main():
    db = Session(engine)
    try:
        # Pega todos os lancamentos agrupados (que tem contribuicoes no json)
        # Vamos restringir a is_deleted = false e que tenham 'grouped_card_launch' na observacao
        query_lancamentos = text("""
            SELECT id, empresa_id, valor_previsto, observacao 
            FROM lancamentos 
            WHERE is_deleted = false 
              AND observacao LIKE '%grouped_card_launch%'
        """)
        
        lancamentos = db.execute(query_lancamentos).fetchall()
        
        # Pega todos os IDs de vendas deletadas
        query_vendas_deletadas = text("SELECT id::text FROM pdv_vendas WHERE is_deleted = true")
        vendas_deletadas = set(row[0] for row in db.execute(query_vendas_deletadas).fetchall())
        
        inconsistencies = []
        
        for lancamento in lancamentos:
            l_id = lancamento[0]
            empresa_id = lancamento[1]
            valor_previsto = lancamento[2]
            obs_str = lancamento[3]
            
            try:
                obs_json = json.loads(obs_str)
                contribuicoes = obs_json.get("contribuicoes", {})
                
                fantasmas = []
                for venda_id, detalhes in contribuicoes.items():
                    if venda_id in vendas_deletadas:
                        fantasmas.append((venda_id, detalhes.get("valor", 0)))
                
                if fantasmas:
                    inconsistencies.append({
                        "lancamento_id": l_id,
                        "empresa_id": empresa_id,
                        "valor_previsto_atual": valor_previsto,
                        "fantasmas": fantasmas
                    })
                    
            except Exception as e:
                print(f"Erro ao parsear JSON do lancamento {l_id}: {e}")
                
        if not inconsistencies:
            print("🎉 Nenhuma outra unidade/lançamento financeiro tem vendas fantasmas!")
        else:
            print(f"⚠️ ATENÇÃO! Foram encontrados {len(inconsistencies)} lançamentos com vendas fantasmas:")
            for inc in inconsistencies:
                print(f" - Lançamento ID {inc['lancamento_id']} (Empresa {inc['empresa_id']}):")
                print(f"   Valor Previsto Atual: R$ {inc['valor_previsto_atual']}")
                soma_fantasma = sum(f[1] for f in inc['fantasmas'])
                print(f"   Contém {len(inc['fantasmas'])} vendas fantasmas somando R$ {soma_fantasma}")
                for f in inc['fantasmas']:
                    print(f"     > Venda {f[0]} | R$ {f[1]}")
                print()
                
    finally:
        db.close()

if __name__ == "__main__":
    main()

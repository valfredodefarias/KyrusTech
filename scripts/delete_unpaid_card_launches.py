import os
import sys

# Adiciona o diretório raiz ao path para que o Python localize a pasta 'app'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine

def delete_unpaid_launches(empresa_id=35, date_str='2026-07-21'):
    print(f"Iniciando a remoção em lote dos lançamentos de cartão atrasados/em aberto de {date_str}...")
    print(f"Empresa ID: {empresa_id}")
    
    with Session(engine) as session:
        # 1. Buscar os lançamentos alvo
        query_select = text("""
            SELECT id, descricao, valor_previsto, status, conciliado 
            FROM lancamentos 
            WHERE empresa_id = :empresa_id 
              AND (data_vencimento = :date_str OR data_pagamento = :date_str)
              AND origem = 'PDV'
              AND status = 'EM ABERTO'
              AND is_deleted = false;
        """)
        
        launches = session.execute(query_select, {"empresa_id": empresa_id, "date_str": date_str}).fetchall()
        
        if not launches:
            print("Nenhum lançamento em aberto/atrasado de cartão encontrado para esta data.")
            return
            
        print(f"Encontrados {len(launches)} lançamentos para processamento.")
        
        launch_ids = [l[0] for l in launches]
        
        # 2. Remover os vínculos em lote_cartao_itens para evitar órfãos ativos
        query_unlink = text("""
            DELETE FROM lote_cartao_itens 
            WHERE lancamento_id IN :launch_ids;
        """)
        res_unlink = session.execute(query_unlink, {"launch_ids": tuple(launch_ids)})
        print(f"Removidos {res_unlink.rowcount} vínculos na tabela lote_cartao_itens.")
        
        # 3. Soft-deletar os lançamentos e desconciliá-los
        query_delete = text("""
            UPDATE lancamentos 
            SET is_deleted = true, 
                conciliado = false, 
                deleted_at = NOW(),
                updated_at = NOW()
            WHERE id IN :launch_ids;
        """)
        res_delete = session.execute(query_delete, {"launch_ids": tuple(launch_ids)})
        session.commit()
        
        print(f"Sucesso! {res_delete.rowcount} lançamentos foram apagados e desconciliados com sucesso.")

if __name__ == "__main__":
    # Permite passar o ID da empresa como argumento (ex: python script.py 37)
    emp_id = 35
    if len(sys.argv) > 1:
        try:
            emp_id = int(sys.argv[1])
        except ValueError:
            print("ID da empresa inválido. Usando padrão 35 (Umarizal).")
            
    delete_unpaid_launches(empresa_id=emp_id)

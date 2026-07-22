import os
import sys
import json

# Adiciona o diretório raiz ao path para que o Python localize a pasta 'app'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine

def restore_unpaid_pix_launches(empresa_id=35, start_date='2026-07-20', end_date='2026-07-22'):
    print(f"Iniciando a restauração de lançamentos PIX em aberto de {start_date} até {end_date}...")
    print(f"Empresa ID: {empresa_id}")
    
    with Session(engine) as session:
        # 1. Buscar os lançamentos de PIX soft-deletados
        query_select = text("""
            SELECT id, descricao, status, valor_previsto, observacao 
            FROM lancamentos 
            WHERE empresa_id = :empresa_id 
              AND data_vencimento BETWEEN :start_date AND :end_date
              AND origem = 'PDV'
              AND is_deleted = true
              AND (observacao LIKE '%PIX%' OR observacao LIKE '%pix%');
        """)
        
        launches = session.execute(
            query_select, 
            {"empresa_id": empresa_id, "start_date": start_date, "end_date": end_date}
        ).fetchall()
        
        if not launches:
            print("Nenhum lançamento PIX em aberto/deletado encontrado nesse intervalo de datas.")
            return
            
        print(f"Encontrados {len(launches)} lançamentos PIX para restaurar.")
        
        restored_ids = []
        for row in launches:
            launch_id = row[0]
            obs = row[4]
            
            # Limpar flags de auto-delete no JSON de observação
            meta = {}
            if obs:
                try:
                    meta = json.loads(obs)
                except Exception:
                    pass
            
            if meta.get("auto_soft_deleted_overdue_pdv") is True:
                meta["auto_soft_deleted_overdue_pdv"] = False
                
            query_update = text("""
                UPDATE lancamentos 
                SET is_deleted = false, 
                    conciliado = false,
                    observacao = :obs_json,
                    deleted_at = NULL,
                    deleted_by_id = NULL,
                    updated_at = NOW()
                WHERE id = :launch_id;
            """)
            session.execute(query_update, {"obs_json": json.dumps(meta), "launch_id": launch_id})
            restored_ids.append(launch_id)
            
        session.commit()
        print(f"Sucesso! {len(restored_ids)} lançamentos PIX foram restaurados no banco de dados.")

if __name__ == "__main__":
    emp_id = 35
    if len(sys.argv) > 1:
        try:
            emp_id = int(sys.argv[1])
        except ValueError:
            print("ID da empresa inválido. Usando padrão 35 (Umarizal).")
            
    restore_unpaid_pix_launches(empresa_id=emp_id)

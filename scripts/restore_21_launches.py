import os
import sys

# Adiciona o diretório raiz ao path para que o Python localize a pasta 'app'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine

def restore_launches():
    print("Conectando ao banco de dados utilizando as configurações do arquivo .env...")
    with Session(engine) as session:
        query = text("""
            UPDATE lancamentos 
            SET is_deleted = false, updated_at = NOW() 
            WHERE empresa_id = 35 
              AND (data_vencimento = '2026-07-21' OR data_pagamento = '2026-07-21') 
              AND is_deleted = true;
        """)
        
        # Executar a alteração
        res = session.execute(query)
        session.commit()
        
        print(f"Sucesso! Foram restaurados {res.rowcount} lançamentos do dia 21/07/2026 no banco de dados.")

if __name__ == "__main__":
    restore_launches()

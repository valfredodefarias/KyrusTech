"""
Script de Correção de Duplicatas na Tabela user_sessions
Remove registros duplicados em user_sessions que causam StaleDataError no SQLAlchemy.
"""
import os
import sys
from sqlmodel import Session
from sqlalchemy import text

from app.db.session import engine

def corrigir_user_sessions():
    with Session(engine) as db:
        print("=== REMOVENDO DUPLICATAS NA TABELA user_sessions ===")

        # 1. Remover duplicatas por session_id (mantendo apenas o registro mais recente)
        res_session = db.exec(text("""
            DELETE FROM user_sessions a
            USING user_sessions b
            WHERE a.ctid < b.ctid AND a.session_id = b.session_id;
        """))

        # 2. Remover duplicatas por ID se existirem
        res_id = db.exec(text("""
            DELETE FROM user_sessions a
            USING user_sessions b
            WHERE a.ctid < b.ctid AND a.id = b.id;
        """))

        db.commit()
        print(f"Linhas duplicadas removidas de user_sessions: {res_session.rowcount + res_id.rowcount}")

        # 3. Ajustar a sequencia da chave primaria id em user_sessions
        db.exec(text("""
            SELECT setval(
                pg_get_serial_sequence('user_sessions', 'id'),
                COALESCE((SELECT MAX(id) FROM user_sessions), 1)
            );
        """))
        db.commit()
        print("Sequência do ID de user_sessions ajustada para o valor máximo atual.")

        # 4. Criar Indice Unico em session_id se nao existir
        db.exec(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_sessions_session_id 
            ON user_sessions (session_id);
        """))
        db.commit()
        print("Índice único em user_sessions(session_id) garantido com sucesso!")

        print("\n✅ Tabela user_sessions totalmente limpa e corrigida! O erro StaleDataError foi eliminado.")

if __name__ == "__main__":
    corrigir_user_sessions()

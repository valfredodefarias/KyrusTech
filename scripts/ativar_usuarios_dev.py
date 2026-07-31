"""
Script para ativar usuarios no banco local de desenvolvimento e resetar a senha de admin@kyrustech.com para admin123.
"""
from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine
from app.core.security import get_password_hash

def ativar_usuarios():
    with Session(engine) as db:
        new_hash = get_password_hash("admin123")
        db.exec(text("UPDATE usuarios SET is_active = true;"))
        db.exec(text(f"UPDATE usuarios SET hashed_password = '{new_hash}' WHERE email = 'admin@kyrustech.com';"))
        db.commit()
        print("✅ Usuários ativados e senha do usuário admin@kyrustech.com resetada para 'admin123'!")

if __name__ == "__main__":
    ativar_usuarios()

"""
Script para criar usuário consultor interno.
Consultores têm acesso a todas as empresas do sistema.
"""
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlmodel import Session, select
from app.db.session import engine
from app.db.base_class import Base
from app.models import *  # noqa: F401, F403
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.core.security import get_password_hash
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_consultor(
    email: str = "consultor@kyrustech.com",
    password: str = "consultor123",
    nome: str = "Consultor Interno"
):
    """
    Cria um usuário consultor interno.
    Consultores têm acesso a todas as empresas.
    """
    with Session(engine) as session:
        try:
            # Verificar se já existe
            usuario_existente = session.exec(
                select(Usuario).where(Usuario.email == email)
            ).first()
            
            if usuario_existente:
                if usuario_existente.is_consultor:
                    logger.info(f"[INFO] Usuario consultor '{email}' ja existe (ID: {usuario_existente.id})")
                    logger.info("[AVISO] Se deseja redefinir a senha, delete o usuario e execute novamente.")
                    return usuario_existente
                else:
                    # Atualizar para consultor
                    logger.info(f"[INFO] Convertendo usuario '{email}' para consultor...")
                    if not getattr(usuario_existente, "nome", None):
                        usuario_existente.nome = nome
                    usuario_existente.is_consultor = True
                    session.add(usuario_existente)
                    session.commit()
                    session.refresh(usuario_existente)
                    logger.info(f"[OK] Usuario convertido para consultor! ID: {usuario_existente.id}")
                    return usuario_existente
            
            # Buscar primeira empresa (para empresa_id padrão)
            primeira_empresa = session.exec(select(Empresa)).first()
            if not primeira_empresa:
                logger.error("[ERRO] Nenhuma empresa encontrada. Crie uma empresa primeiro.")
                return None
            
            # Criar consultor
            logger.info(f"[INFO] Criando usuario consultor '{email}'...")
            hashed_password = get_password_hash(password)
            
            consultor = Usuario(
                nome=nome,
                email=email,
                hashed_password=hashed_password,
                is_active=True,
                is_consultor=True,
                consultor_role="CONSULTOR",  # Consultor normal
                empresa_id=primeira_empresa.id  # Empresa padrão (pode trocar depois)
            )
            session.add(consultor)
            session.commit()
            session.refresh(consultor)
            
            logger.info(f"[OK] Usuario consultor criado com sucesso! ID: {consultor.id}")
            
            # Mostrar informações
            print("\n" + "=" * 60)
            print("USUARIO CONSULTOR CRIADO COM SUCESSO!")
            print("=" * 60)
            print(f"\nEmail: {consultor.email}")
            print(f"Senha: {password}")
            print(f"Tipo: Consultor Interno (Acesso Total)")
            print(f"Empresa Padrao: {primeira_empresa.nome_fantasia} (ID: {primeira_empresa.id})")
            print("\n" + "=" * 60)
            print("IMPORTANTE:")
            print("  - Altere a senha apos o primeiro login!")
            print("  - Acesse /consultor.html para gerenciar empresas")
            print("  - Todas as acoes sao registradas para auditoria")
            print("=" * 60 + "\n")
            
            return consultor
            
        except Exception as e:
            logger.error(f"[ERRO] Falha ao criar consultor: {e}")
            session.rollback()
            raise


if __name__ == "__main__":
    import sys
    
    email = "consultor@kyrustech.com"
    password = "consultor123"
    nome = "Consultor Interno"
    
    if len(sys.argv) > 1:
        email = sys.argv[1]
    if len(sys.argv) > 2:
        password = sys.argv[2]
    if len(sys.argv) > 3:
        nome = sys.argv[3]
    
    try:
        consultor = create_consultor(email, password, nome)
        if consultor:
            print("[SUCESSO] Consultor criado com sucesso!")
        else:
            print("[ERRO] Falha ao criar consultor")
            sys.exit(1)
    except Exception as e:
        print(f"[ERRO] Erro: {e}")
        sys.exit(1)


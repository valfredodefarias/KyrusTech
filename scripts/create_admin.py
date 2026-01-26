"""
Script para criar empresa inicial e usuário admin.
Executa a inicialização do sistema com dados padrão.
"""
import sys
from pathlib import Path

# Adiciona o diretório raiz ao path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlmodel import Session, select, SQLModel
from app.db.session import engine
from app.db.base_class import Base
# Importa todos os modelos para garantir que os relacionamentos sejam resolvidos
from app.models import *  # noqa: F401, F403
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.core.security import get_password_hash
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_initial_data():
    """
    Cria a empresa inicial e o usuário admin.
    """
    # Garante que as tabelas existam antes de consultar/criar dados
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        try:
            # 1. Verificar se a empresa já existe
            empresa_existente = session.exec(
                select(Empresa).where(Empresa.nome_fantasia == "KyrusTech")
            ).first()
            
            if empresa_existente:
                logger.info(f"[INFO] Empresa 'KyrusTech' ja existe (ID: {empresa_existente.id})")
                empresa = empresa_existente
            else:
                # 2. Criar empresa
                logger.info("[INFO] Criando empresa 'KyrusTech'...")
                empresa = Empresa(
                    nome_fantasia="KyrusTech",
                    razao_social="KyrusTech Sistemas",
                    cnpj=None,  # Pode ser preenchido depois
                    cor_primaria="#0d6efd"
                )
                session.add(empresa)
                session.commit()
                session.refresh(empresa)
                logger.info(f"[OK] Empresa criada com sucesso! ID: {empresa.id}")
            
            # 3. Verificar se o usuário admin já existe
            usuario_existente = session.exec(
                select(Usuario).where(Usuario.email == "admin@kyrustech.com")
            ).first()
            
            if usuario_existente:
                logger.info(f"[INFO] Usuario admin ja existe (ID: {usuario_existente.id})")
                logger.info("[AVISO] Se deseja redefinir a senha, delete o usuario e execute novamente.")
                return empresa, usuario_existente
            
            # 4. Criar usuário admin
            logger.info("[INFO] Criando usuario admin...")
            senha_admin = "admin123"  # Senha padrão - DEVE SER ALTERADA EM PRODUÇÃO
            hashed_password = get_password_hash(senha_admin)
            
            # Admin padrão também é consultor para acessar o painel /consultor
            usuario = Usuario(
                nome="Administrador",
                email="admin@kyrustech.com",
                hashed_password=hashed_password,
                is_active=True,
                is_consultor=True,
                consultor_role="SUPER_CONSULTOR",  # Admin é super consultor
                empresa_id=empresa.id
            )
            session.add(usuario)
            session.commit()
            session.refresh(usuario)
            
            logger.info(f"[OK] Usuario admin criado com sucesso! ID: {usuario.id}")
            
            # 5. Mostrar informações de acesso
            print("\n" + "=" * 60)
            print("DADOS DE ACESSO CRIADOS COM SUCESSO!")
            print("=" * 60)
            print(f"\nEmpresa: {empresa.nome_fantasia}")
            print(f"  ID: {empresa.id}")
            print(f"  Razao Social: {empresa.razao_social}")
            print(f"\nUsuario Admin:")
            print(f"  Email: {usuario.email}")
            print(f"  Senha: {senha_admin}")
            print(f"  Status: {'Ativo' if usuario.is_active else 'Inativo'}")
            print("\n" + "=" * 60)
            print("IMPORTANTE: Altere a senha apos o primeiro login!")
            print("=" * 60 + "\n")
            
            return empresa, usuario
            
        except Exception as e:
            logger.error(f"[ERRO] Falha ao criar dados iniciais: {e}")
            session.rollback()
            raise


if __name__ == "__main__":
    try:
        create_initial_data()
        print("[SUCESSO] Dados iniciais criados com sucesso!")
    except Exception as e:
        print(f"[ERRO] Erro ao criar dados iniciais: {e}")
        sys.exit(1)


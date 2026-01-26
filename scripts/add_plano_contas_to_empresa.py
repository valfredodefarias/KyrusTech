"""
Script para adicionar plano de contas padrão à empresa existente.
Útil quando a empresa foi criada antes da implementação do plano de contas.
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
from app.models.plano_contas import PlanoContas
from app.crud.crud_plano_contas import seed_plano_contas_padrao
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def add_plano_contas_to_empresa(empresa_id: int = None):
    """
    Adiciona plano de contas padrão à empresa.
    Se empresa_id não for fornecido, usa a primeira empresa encontrada.
    """
    with Session(engine) as session:
        try:
            # Busca a empresa
            if empresa_id:
                empresa = session.get(Empresa, empresa_id)
                if not empresa:
                    logger.error(f"[ERRO] Empresa com ID {empresa_id} nao encontrada")
                    return False
            else:
                # Busca a primeira empresa
                empresa = session.exec(select(Empresa)).first()
                if not empresa:
                    logger.error("[ERRO] Nenhuma empresa encontrada no banco de dados")
                    return False
            
            logger.info(f"[INFO] Empresa encontrada: {empresa.nome_fantasia} (ID: {empresa.id})")
            
            # Verifica se já existe plano de contas
            plano_existente = session.exec(
                select(PlanoContas).where(PlanoContas.empresa_id == empresa.id)
            ).first()
            
            if plano_existente:
                logger.warning(f"[AVISO] Empresa ja possui plano de contas ({plano_existente.nome})")
                resposta = input("Deseja recriar o plano de contas? Isso apagara os existentes. (s/N): ")
                if resposta.lower() != 's':
                    logger.info("[INFO] Operacao cancelada pelo usuario")
                    return False
                
                # Remove plano de contas existente
                logger.info("[INFO] Removendo plano de contas existente...")
                contas_existentes = session.exec(
                    select(PlanoContas).where(PlanoContas.empresa_id == empresa.id)
                ).all()
                for conta in contas_existentes:
                    session.delete(conta)
                session.commit()
                logger.info(f"[OK] {len(contas_existentes)} contas removidas")
            
            # Cria o plano de contas padrão
            logger.info("[INFO] Criando plano de contas padrao...")
            seed_plano_contas_padrao(db=session, empresa_id=empresa.id)
            session.commit()
            
            # Conta quantas contas foram criadas
            total_contas = session.exec(
                select(PlanoContas).where(PlanoContas.empresa_id == empresa.id)
            ).all()
            
            logger.info(f"[OK] Plano de contas criado com sucesso!")
            logger.info(f"[OK] Total de contas criadas: {len(total_contas)}")
            
            print("\n" + "=" * 60)
            print("PLANO DE CONTAS CRIADO COM SUCESSO!")
            print("=" * 60)
            print(f"\nEmpresa: {empresa.nome_fantasia}")
            print(f"Total de Contas: {len(total_contas)}")
            print("\nEstrutura criada:")
            print("  - Receitas Operacionais")
            print("  - Deduções de Receitas")
            print("  - Receitas Não Operacionais")
            print("  - Custos de Produção/Serviços")
            print("  - Despesas Operacionais (8 categorias principais)")
            print("  - Despesas Não Operacionais")
            print("\n" + "=" * 60)
            print("IMPORTANTE: Cada empresa pode personalizar seu plano de contas!")
            print("=" * 60 + "\n")
            
            return True
            
        except Exception as e:
            logger.error(f"[ERRO] Falha ao criar plano de contas: {e}")
            session.rollback()
            raise


if __name__ == "__main__":
    import sys
    empresa_id = None
    if len(sys.argv) > 1:
        try:
            empresa_id = int(sys.argv[1])
        except ValueError:
            print(f"[ERRO] ID da empresa invalido: {sys.argv[1]}")
            sys.exit(1)
    
    try:
        success = add_plano_contas_to_empresa(empresa_id)
        if success:
            print("[SUCESSO] Plano de contas adicionado com sucesso!")
        else:
            print("[ERRO] Falha ao adicionar plano de contas")
            sys.exit(1)
    except Exception as e:
        print(f"[ERRO] Erro: {e}")
        sys.exit(1)


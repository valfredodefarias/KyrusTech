from sqlmodel import Session, SQLModel, create_engine
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.plano_contas import PlanoContas
from app.core.security import get_password_hash

# Troque pelo IP do seu HostHatch para rodar local ou 'kyrus-db' se rodar dentro do Docker
engine = create_engine("postgresql://kyrus_admin:Consultoria@2025@Consultoria@2025:5432/kyrus_erp")

def setup_inicial():
    SQLModel.metadata.create_all(engine) # Cria as tabelas
    
    with Session(engine) as session:
        # 1. Cria a Empresa
        nova_empresa = Empresa(nome_fantasia="Kyrus ERP", razao_social="Kyrus Sistemas LTDA", cnpj="12345678000199")
        session.add(nova_empresa)
        session.commit()
        session.refresh(nova_empresa)

        # 2. Cria o Usuário Admin
        admin = Usuario(
            email="admin@admin.com",
            hashed_password=get_password_hash("admin123"), # Altere depois!
            nome_completo="Administrador",
            empresa_id=nova_empresa.id,
            is_superuser=True
        )
        session.add(admin)
        
        # 3. Plano de Contas básico para o Importador não quebrar
        p1 = PlanoContas(nome="Vendas", tipo="R", codigo="1.1", empresa_id=nova_empresa.id)
        p2 = PlanoContas(nome="Fornecedores", tipo="D", codigo="2.1", empresa_id=nova_empresa.id)
        session.add_all([p1, p2])
        
        session.commit()
        print("✅ Banco pronto! Usuário: admin@admin.com | Senha: admin123")

if __name__ == "__main__":
    setup_inicial()
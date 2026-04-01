# app/db/base_class.py
from sqlmodel import SQLModel

# Importe TODOS os modelos aqui para o Alembic detectar
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
# Novos modelos
from app.models.entidade import Entidade
from app.models.cartao import Cartao
from app.models.centro_custo import CentroCusto
from app.models.lancamento import Lancamento
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.mapeamento_categoria import MapeamentoCategoria

class Base(SQLModel):
    pass
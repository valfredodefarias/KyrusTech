# app/db/base_class.py
from sqlmodel import SQLModel

# Importe TODOS os modelos aqui para o Alembic detectar
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
# Novos modelos
from app.models.entidade import Entidade
from app.models.cartao import Cartao
from app.models.centro_custo import CentroCusto
from app.models.lancamento import Lancamento

class Base(SQLModel):
    pass
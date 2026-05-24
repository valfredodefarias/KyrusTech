"""Carrega todos os modelos para registro no SQLModel.metadata."""

from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile
from app.models.plano_contas import PlanoContas
from app.models.orcamento import Orcamento
from app.models.conta import Conta
from app.models.entidade import Entidade
from app.models.cartao import Cartao
from app.models.centro_custo import CentroCusto
from app.models.anexo_lancamento import AnexoLancamento
from app.models.lancamento import Lancamento
from app.models.import_job import ImportJob
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.models.plano_contas_template_config import PlanoContasTemplateConfig
from app.models.bank_preset_config import BankPresetConfig
from app.models.audit_log import AuditLog
from app.models.base_audit import AuditMixin
from app.models.todo_item import TodoItem

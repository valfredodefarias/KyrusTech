"""add_silencing_rules_and_audit_hashes"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fafe2e895f4e'
down_revision: Union[str, None] = '0fbc1f2ba4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    # 1. Adicionar colunas de hash criptográfico
    op.add_column("audit_logs", sa.Column("signature_hash", sa.String(), nullable=True))
    op.add_column("audit_logs", sa.Column("previous_hash", sa.String(), nullable=True))
    op.create_index("ix_audit_logs_signature_hash", "audit_logs", ["signature_hash"], unique=False)
    op.create_index("ix_audit_logs_previous_hash", "audit_logs", ["previous_hash"], unique=False)

    # 2. Criar a tabela regras_silenciamento_auditor
    op.create_table(
        "regras_silenciamento_auditor",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tipo_anomalia", sa.String(), nullable=False),
        sa.Column("plano_contas_id", sa.Integer(), sa.ForeignKey("plano_contas.id"), nullable=True),
        sa.Column("entidade_id", sa.Integer(), sa.ForeignKey("entidades.id"), nullable=True),
        sa.Column("valor_limite", sa.Float(), nullable=True),
        sa.Column("empresa_id", sa.Integer(), sa.ForeignKey("empresas.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_regras_silenciamento_auditor_tipo_anomalia", "regras_silenciamento_auditor", ["tipo_anomalia"], unique=False)
    op.create_index("ix_regras_silenciamento_auditor_empresa_id", "regras_silenciamento_auditor", ["empresa_id"], unique=False)
    op.create_index("ix_regras_silenciamento_auditor_is_deleted", "regras_silenciamento_auditor", ["is_deleted"], unique=False)

def downgrade() -> None:
    # 1. Remover tabela de regras
    op.drop_index("ix_regras_silenciamento_auditor_is_deleted", table_name="regras_silenciamento_auditor")
    op.drop_index("ix_regras_silenciamento_auditor_empresa_id", table_name="regras_silenciamento_auditor")
    op.drop_index("ix_regras_silenciamento_auditor_tipo_anomalia", table_name="regras_silenciamento_auditor")
    op.drop_table("regras_silenciamento_auditor")

    # 2. Remover colunas de hash
    op.drop_index("ix_audit_logs_previous_hash", table_name="audit_logs")
    op.drop_index("ix_audit_logs_signature_hash", table_name="audit_logs")
    op.drop_column("audit_logs", "previous_hash")
    op.drop_column("audit_logs", "signature_hash")
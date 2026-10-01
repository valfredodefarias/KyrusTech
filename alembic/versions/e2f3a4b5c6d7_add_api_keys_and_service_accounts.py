"""add_api_keys_and_service_accounts

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-09-30
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from datetime import datetime


# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Campo is_service_account na tabela usuarios
    op.add_column('usuarios', sa.Column('is_service_account', sa.Boolean(), server_default='false', nullable=False))
    op.create_index('ix_usuarios_is_service_account', 'usuarios', ['is_service_account'], unique=False)

    # 2. Tabela api_keys
    op.create_table(
        'api_keys',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.Column('service_user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('key_prefix', sa.String(length=16), nullable=False),
        sa.Column('key_hash', sa.String(length=64), nullable=False),
        sa.Column('environment', sa.String(length=10), server_default='live', nullable=False),
        sa.Column('profile_id', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('last_used_ip', sa.String(length=64), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], name='fk_api_keys_empresa_id_empresas', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['service_user_id'], ['usuarios.id'], name='fk_api_keys_service_user_id_usuarios', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['profile_id'], ['access_profiles.id'], name='fk_api_keys_profile_id_access_profiles', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['revoked_by_user_id'], ['usuarios.id'], name='fk_api_keys_revoked_by_user_id_usuarios', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['usuarios.id'], name='fk_api_keys_created_by_user_id_usuarios', ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('service_user_id', name='uq_api_keys_service_user_id'),
        sa.UniqueConstraint('key_prefix', name='uq_api_keys_key_prefix')
    )
    op.create_index('ix_api_keys_empresa_id', 'api_keys', ['empresa_id'], unique=False)
    op.create_index('ix_api_keys_service_user_id', 'api_keys', ['service_user_id'], unique=True)
    op.create_index('ix_api_keys_key_prefix', 'api_keys', ['key_prefix'], unique=True)
    op.create_index('ix_api_keys_profile_id', 'api_keys', ['profile_id'], unique=False)
    op.create_index('ix_api_keys_is_active', 'api_keys', ['is_active'], unique=False)
    op.create_index('ix_api_keys_is_deleted', 'api_keys', ['is_deleted'], unique=False)

    # 3. Coluna api_key_id em audit_logs
    op.add_column('audit_logs', sa.Column('api_key_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_audit_logs_api_key_id_api_keys', 'audit_logs', 'api_keys', ['api_key_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_audit_logs_api_key_id', 'audit_logs', ['api_key_id'], unique=False)

    # 4. Ajuste da tabela idempotency_logs
    op.execute("ALTER TABLE idempotency_logs DROP CONSTRAINT IF EXISTS idempotency_logs_pkey")
    op.execute("ALTER TABLE idempotency_logs ADD COLUMN id SERIAL PRIMARY KEY")
    op.add_column('idempotency_logs', sa.Column('empresa_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_idempotency_logs_empresa_id_empresas', 'idempotency_logs', 'empresas', ['empresa_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_idempotency_logs_empresa_id', 'idempotency_logs', ['empresa_id'], unique=False)
    op.create_index('ix_idempotency_logs_idempotency_key', 'idempotency_logs', ['idempotency_key'], unique=False)
    op.create_unique_constraint('uq_idempotency_empresa_key', 'idempotency_logs', ['empresa_id', 'idempotency_key'])

    # 5. Seed da permissão config.api_keys.manage
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO access_permissions
                (created_at, updated_at, created_by_id, updated_by_id, is_deleted, deleted_at, deleted_by_id,
                 code, module, action, description, is_page_level, is_active)
            VALUES
                (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, false, NULL, NULL,
                 'config.api_keys.manage', 'config', 'api_keys_manage', 'Gerenciar chaves de API e integracoes', false, true)
            ON CONFLICT (code)
            DO UPDATE SET
                updated_at = CURRENT_TIMESTAMP,
                module = EXCLUDED.module,
                action = EXCLUDED.action,
                description = EXCLUDED.description,
                is_page_level = EXCLUDED.is_page_level,
                is_active = true,
                is_deleted = false
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM access_permissions WHERE code = 'config.api_keys.manage'"))

    op.drop_constraint('uq_idempotency_empresa_key', 'idempotency_logs', type_='unique')
    op.drop_index('ix_idempotency_logs_idempotency_key', table_name='idempotency_logs')
    op.drop_constraint('fk_idempotency_logs_empresa_id_empresas', 'idempotency_logs', type_='foreignkey')
    op.drop_index('ix_idempotency_logs_empresa_id', table_name='idempotency_logs')
    op.drop_column('idempotency_logs', 'empresa_id')
    op.execute("ALTER TABLE idempotency_logs DROP CONSTRAINT IF EXISTS idempotency_logs_pkey")
    op.drop_column('idempotency_logs', 'id')
    op.create_primary_key('idempotency_logs_pkey', 'idempotency_logs', ['idempotency_key'])

    op.drop_index('ix_audit_logs_api_key_id', table_name='audit_logs')
    op.drop_constraint('fk_audit_logs_api_key_id_api_keys', 'audit_logs', type_='foreignkey')
    op.drop_column('audit_logs', 'api_key_id')

    op.drop_index('ix_api_keys_is_deleted', table_name='api_keys')
    op.drop_index('ix_api_keys_is_active', table_name='api_keys')
    op.drop_index('ix_api_keys_profile_id', table_name='api_keys')
    op.drop_index('ix_api_keys_key_prefix', table_name='api_keys')
    op.drop_index('ix_api_keys_service_user_id', table_name='api_keys')
    op.drop_index('ix_api_keys_empresa_id', table_name='api_keys')
    op.drop_table('api_keys')

    op.drop_index('ix_usuarios_is_service_account', table_name='usuarios')
    op.drop_column('usuarios', 'is_service_account')

"""add_telefone_and_email_verification

Revision ID: d1e2f3a4b5c6
Revises: c1d2e3f4a5b6
Create Date: 2026-09-27
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar telefone e email_confirmado na tabela usuarios
    op.add_column('usuarios', sa.Column('telefone', sa.String(length=50), nullable=True))
    op.add_column('usuarios', sa.Column('email_confirmado', sa.Boolean(), server_default='false', nullable=False))

    # 2. Criar tabela email_verification_codes
    op.create_table(
        'email_verification_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('code_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id'], name='fk_email_verification_codes_usuario_id_usuarios', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_email_verification_codes_usuario_id', 'email_verification_codes', ['usuario_id'], unique=False)
    op.create_index('ix_email_verification_codes_email', 'email_verification_codes', ['email'], unique=False)
    op.create_index('ix_email_verification_codes_code_hash', 'email_verification_codes', ['code_hash'], unique=False)
    op.create_index('ix_email_verification_codes_expires_at', 'email_verification_codes', ['expires_at'], unique=False)
    op.create_index('ix_email_verification_codes_used', 'email_verification_codes', ['used'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_email_verification_codes_used', table_name='email_verification_codes')
    op.drop_index('ix_email_verification_codes_expires_at', table_name='email_verification_codes')
    op.drop_index('ix_email_verification_codes_code_hash', table_name='email_verification_codes')
    op.drop_index('ix_email_verification_codes_email', table_name='email_verification_codes')
    op.drop_index('ix_email_verification_codes_usuario_id', table_name='email_verification_codes')
    op.drop_table('email_verification_codes')

    op.drop_column('usuarios', 'email_confirmado')
    op.drop_column('usuarios', 'telefone')

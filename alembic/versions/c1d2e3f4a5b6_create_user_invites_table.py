"""create_user_invites_table

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-09-17
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_invites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('token_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id'], name='fk_user_invites_usuario_id_usuarios'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_user_invites_usuario_id', 'user_invites', ['usuario_id'], unique=False)
    op.create_index('ix_user_invites_email', 'user_invites', ['email'], unique=False)
    op.create_index('ix_user_invites_token_hash', 'user_invites', ['token_hash'], unique=False)
    op.create_index('ix_user_invites_expires_at', 'user_invites', ['expires_at'], unique=False)
    op.create_index('ix_user_invites_used', 'user_invites', ['used'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_user_invites_used', table_name='user_invites')
    op.drop_index('ix_user_invites_expires_at', table_name='user_invites')
    op.drop_index('ix_user_invites_token_hash', table_name='user_invites')
    op.drop_index('ix_user_invites_email', table_name='user_invites')
    op.drop_index('ix_user_invites_usuario_id', table_name='user_invites')
    op.drop_table('user_invites')

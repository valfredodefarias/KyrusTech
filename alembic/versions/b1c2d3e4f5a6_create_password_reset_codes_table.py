"""create_password_reset_codes_table

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-09-16
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'password_reset_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('code_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_password_reset_codes_email', 'password_reset_codes', ['email'], unique=False)
    op.create_index('ix_password_reset_codes_code_hash', 'password_reset_codes', ['code_hash'], unique=False)
    op.create_index('ix_password_reset_codes_expires_at', 'password_reset_codes', ['expires_at'], unique=False)
    op.create_index('ix_password_reset_codes_used', 'password_reset_codes', ['used'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_password_reset_codes_used', table_name='password_reset_codes')
    op.drop_index('ix_password_reset_codes_expires_at', table_name='password_reset_codes')
    op.drop_index('ix_password_reset_codes_code_hash', table_name='password_reset_codes')
    op.drop_index('ix_password_reset_codes_email', table_name='password_reset_codes')
    op.drop_table('password_reset_codes')

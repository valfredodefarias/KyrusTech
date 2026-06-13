"""create_produtos_table

Revision ID: 9bf8a25c68f2
Revises: 90e2ca0bf60e
Create Date: 2026-06-13 03:17:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = '9bf8a25c68f2'
down_revision: Union[str, None] = '90e2ca0bf60e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table('produtos',
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by_id', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nome', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('preco_unitario', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_produtos_empresa_id'), 'produtos', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_produtos_is_active'), 'produtos', ['is_active'], unique=False)
    op.create_index(op.f('ix_produtos_is_deleted'), 'produtos', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_produtos_nome'), 'produtos', ['nome'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_produtos_nome'), table_name='produtos')
    op.drop_index(op.f('ix_produtos_is_deleted'), table_name='produtos')
    op.drop_index(op.f('ix_produtos_is_active'), table_name='produtos')
    op.drop_index(op.f('ix_produtos_empresa_id'), table_name='produtos')
    op.drop_table('produtos')

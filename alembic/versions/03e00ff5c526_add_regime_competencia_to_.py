"""Add regime_competencia to LancamentoCartao"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = '03e00ff5c526'
down_revision: Union[str, None] = '3444df080f3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('lancamentos_cartao', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('lancamentos_cartao', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('lancamentos_cartao', sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('lancamentos_cartao', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.add_column('lancamentos_cartao', sa.Column('regime_competencia', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='COMPRA'))
    op.create_index(op.f('ix_lancamentos_cartao_is_deleted'), 'lancamentos_cartao', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_regime_competencia'), 'lancamentos_cartao', ['regime_competencia'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_lancamentos_cartao_regime_competencia'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_is_deleted'), table_name='lancamentos_cartao')
    op.drop_column('lancamentos_cartao', 'regime_competencia')
    op.drop_column('lancamentos_cartao', 'deleted_by_id')
    op.drop_column('lancamentos_cartao', 'is_deleted')
    op.drop_column('lancamentos_cartao', 'updated_by_id')
    op.drop_column('lancamentos_cartao', 'created_by_id')
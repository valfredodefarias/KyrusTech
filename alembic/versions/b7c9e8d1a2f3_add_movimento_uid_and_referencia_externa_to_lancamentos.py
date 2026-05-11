"""Add movimento_uid and referencia_externa to lancamentos"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c9e8d1a2f3'
down_revision: Union[str, None] = 'ab6a1ba62ac6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('lancamentos', sa.Column('movimento_uid', sa.String(), nullable=True))
    op.add_column('lancamentos', sa.Column('referencia_externa', sa.String(), nullable=True))
    op.create_index(op.f('ix_lancamentos_movimento_uid'), 'lancamentos', ['movimento_uid'], unique=False)
    op.create_index(op.f('ix_lancamentos_referencia_externa'), 'lancamentos', ['referencia_externa'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_lancamentos_referencia_externa'), table_name='lancamentos')
    op.drop_index(op.f('ix_lancamentos_movimento_uid'), table_name='lancamentos')
    op.drop_column('lancamentos', 'referencia_externa')
    op.drop_column('lancamentos', 'movimento_uid')
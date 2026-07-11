"""add_composite_indexes_to_lancamentos"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '818a9d12a9d1'
down_revision: Union[str, None] = 'fafe2e895f4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.create_index('idx_lancamentos_emp_venc', 'lancamentos', ['empresa_id', 'is_deleted', 'data_vencimento'])
    op.create_index('idx_lancamentos_emp_pag', 'lancamentos', ['empresa_id', 'is_deleted', 'data_pagamento'])

def downgrade() -> None:
    op.drop_index('idx_lancamentos_emp_venc', table_name='lancamentos')
    op.drop_index('idx_lancamentos_emp_pag', table_name='lancamentos')
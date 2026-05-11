"""Merge legacy usuario heads"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_20260126'
down_revision: Union[str, tuple[str, str]] = ('usuario_nome_002', 'f9bd5c1c0c3b')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
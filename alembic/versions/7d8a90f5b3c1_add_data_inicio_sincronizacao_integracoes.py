"""add_data_inicio_sincronizacao_integracoes

Revision ID: 7d8a90f5b3c1
Revises: 4a72b9e1d3f4
Create Date: 2026-04-06 13:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7d8a90f5b3c1"
down_revision: Union[str, None] = "4a72b9e1d3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "integracoes_bancarias",
        sa.Column("data_inicio_sincronizacao", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("integracoes_bancarias", "data_inicio_sincronizacao")

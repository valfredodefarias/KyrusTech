"""add_nfe_fornecedores_categoria_config_to_empresa

Revision ID: f1c2d3e4a5b6
Revises: 4a72b9e1d3f4
Create Date: 2026-04-20

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1c2d3e4a5b6"
down_revision: Union[str, None] = "7d8a90f5b3c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("empresas", sa.Column("categoria_nfe_fornecedores_id", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_empresas_categoria_nfe_fornecedores_id"),
        "empresas",
        ["categoria_nfe_fornecedores_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_empresas_categoria_nfe_fornecedores_id"), table_name="empresas")
    op.drop_column("empresas", "categoria_nfe_fornecedores_id")

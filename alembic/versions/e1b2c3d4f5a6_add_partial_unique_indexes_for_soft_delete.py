"""add_partial_unique_indexes_for_soft_delete

Revision ID: e1b2c3d4f5a6
Revises: 03e00ff5c526
Create Date: 2026-09-11
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1b2c3d4f5a6'
down_revision: Union[str, None] = '03e00ff5c526'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    is_sqlite = bind.dialect.name == "sqlite"

    # 1. Movimentos: substituir ix_movimentos_import_hash incondicional por índice parcial
    try:
        op.drop_index("ix_movimentos_import_hash", table_name="movimentos")
    except Exception:
        pass

    if is_postgres:
        op.create_index(
            "ix_movimentos_import_hash",
            "movimentos",
            ["import_hash"],
            unique=True,
            postgresql_where=sa.text("is_deleted = false"),
        )
    elif is_sqlite:
        op.create_index(
            "ix_movimentos_import_hash",
            "movimentos",
            ["import_hash"],
            unique=True,
            sqlite_where=sa.text("is_deleted = 0"),
        )
    else:
        op.create_index("ix_movimentos_import_hash", "movimentos", ["import_hash"], unique=False)

    # 2. PdvMovimentacoes: substituir ix_pdv_movimentacoes_import_hash incondicional por índice parcial
    try:
        op.drop_index("ix_pdv_movimentacoes_import_hash", table_name="pdv_movimentacoes")
    except Exception:
        pass

    if is_postgres:
        op.create_index(
            "ix_pdv_movimentacoes_import_hash",
            "pdv_movimentacoes",
            ["import_hash"],
            unique=True,
            postgresql_where=sa.text("is_deleted = false AND import_hash IS NOT NULL"),
        )
    elif is_sqlite:
        op.create_index(
            "ix_pdv_movimentacoes_import_hash",
            "pdv_movimentacoes",
            ["import_hash"],
            unique=True,
            sqlite_where=sa.text("is_deleted = 0 AND import_hash IS NOT NULL"),
        )
    else:
        op.create_index("ix_pdv_movimentacoes_import_hash", "pdv_movimentacoes", ["import_hash"], unique=False)


def downgrade() -> None:
    try:
        op.drop_index("ix_movimentos_import_hash", table_name="movimentos")
    except Exception:
        pass
    op.create_index("ix_movimentos_import_hash", "movimentos", ["import_hash"], unique=True)

    try:
        op.drop_index("ix_pdv_movimentacoes_import_hash", table_name="pdv_movimentacoes")
    except Exception:
        pass
    op.create_index("ix_pdv_movimentacoes_import_hash", "pdv_movimentacoes", ["import_hash"], unique=True)

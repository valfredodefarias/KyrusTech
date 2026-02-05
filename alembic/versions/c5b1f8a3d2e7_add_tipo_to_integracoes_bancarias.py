"""Add tipo column to integracoes_bancarias

Revision ID: c5b1f8a3d2e7
Revises: auditlog_001, b6f2a9c7d3e1
Create Date: 2026-02-05

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5b1f8a3d2e7'
down_revision: Union[str, tuple[str, ...]] = ('auditlog_001', 'b6f2a9c7d3e1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('integracoes_bancarias', sa.Column('tipo', sa.String(), nullable=True))
    op.create_index(op.f('ix_integracoes_bancarias_tipo'), 'integracoes_bancarias', ['tipo'], unique=False)

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name='integracoes_bancarias'
                  AND column_name='provedor'
            ) THEN
                UPDATE integracoes_bancarias
                SET tipo = provedor
                WHERE tipo IS NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_integracoes_bancarias_tipo'), table_name='integracoes_bancarias')
    op.drop_column('integracoes_bancarias', 'tipo')

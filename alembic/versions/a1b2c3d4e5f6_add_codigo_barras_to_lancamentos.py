"""add_codigo_barras_to_lancamentos

Revision ID: a1b2c3d4e5f6
Revises: f2a3b4c5d6e7
Create Date: 2026-09-15
"""
from typing import Sequence, Union
import json
import re
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column, select


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar coluna codigo_barras
    op.add_column('lancamentos', sa.Column('codigo_barras', sa.String(length=100), nullable=True))
    op.create_index('ix_lancamentos_codigo_barras', 'lancamentos', ['codigo_barras'], unique=False)

    # 2. Backfill de dados históricos
    conn = op.get_bind()
    lancamentos_t = table(
        'lancamentos',
        column('id', sa.Integer),
        column('observacao', sa.String),
        column('codigo_barras', sa.String),
    )

    rows = conn.execute(
        select(lancamentos_t.c.id, lancamentos_t.c.observacao)
        .where(lancamentos_t.c.observacao.is_not(None))
    ).fetchall()

    for row_id, obs in rows:
        if not obs or not isinstance(obs, str):
            continue

        trimmed = obs.strip()
        extracted_barcode = None
        new_obs = obs

        # Caso A: JSON serializado antigo que continha codigo_barras
        if trimmed.startswith('{') and trimmed.endswith('}'):
            try:
                data = json.loads(trimmed)
                if isinstance(data, dict) and data.get('codigo_barras'):
                    extracted_barcode = str(data['codigo_barras']).strip()
                    user_notes = data.get('user_notes')
                    new_obs = str(user_notes) if user_notes else None
            except Exception:
                pass

        # Caso B: Observação puramente numérica de boleto/linha digitável (44 a 55 caracteres)
        elif re.match(r'^[0-9.\s-]{44,60}$', trimmed):
            digits = re.sub(r'\D', '', trimmed)
            if len(digits) in (44, 47, 48):
                extracted_barcode = trimmed
                new_obs = None

        if extracted_barcode:
            conn.execute(
                lancamentos_t.update()
                .where(lancamentos_t.c.id == row_id)
                .values(codigo_barras=extracted_barcode, observacao=new_obs)
            )


def downgrade() -> None:
    op.drop_index('ix_lancamentos_codigo_barras', table_name='lancamentos')
    op.drop_column('lancamentos', 'codigo_barras')

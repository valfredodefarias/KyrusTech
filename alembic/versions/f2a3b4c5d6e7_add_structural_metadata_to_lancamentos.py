"""add_structural_metadata_to_lancamentos

Revision ID: f2a3b4c5d6e7
Revises: e1b2c3d4f5a6
Create Date: 2026-09-15
"""
from typing import Sequence, Union
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column, select


# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1b2c3d4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar colunas estruturais
    op.add_column('lancamentos', sa.Column('lote_cartao_id', sa.Integer(), nullable=True))
    op.add_column('lancamentos', sa.Column('tipo_origem', sa.String(length=60), nullable=True))
    op.add_column('lancamentos', sa.Column('origem_uuid', sa.String(length=100), nullable=True))

    # 2. Criar índices
    op.create_index('ix_lancamentos_lote_cartao_id', 'lancamentos', ['lote_cartao_id'], unique=False)
    op.create_index('ix_lancamentos_tipo_origem', 'lancamentos', ['tipo_origem'], unique=False)
    op.create_index('ix_lancamentos_origem_uuid', 'lancamentos', ['origem_uuid'], unique=False)

    # 3. Criar Foreign Key para lotes_cartao
    try:
        op.create_foreign_key(
            'fk_lancamentos_lote_cartao_id_lotes_cartao',
            'lancamentos',
            'lotes_cartao',
            ['lote_cartao_id'],
            ['id'],
            ondelete='SET NULL'
        )
    except Exception:
        # SQLite pode ignorar se rodar sem suporte a batch alter, mas em Postgres funciona perfeitamente
        pass

    # 4. Backfill seguro de registros históricos que contêm metadados JSON no campo observacao
    conn = op.get_bind()
    lancamentos_tbl = table(
        'lancamentos',
        column('id', sa.Integer),
        column('observacao', sa.Text),
        column('lote_cartao_id', sa.Integer),
        column('tipo_origem', sa.String),
        column('origem_uuid', sa.String)
    )

    try:
        # Busca apenas os lançamentos com probabilidade de ter JSON no campo observação
        query = select(lancamentos_tbl.c.id, lancamentos_tbl.c.observacao).where(
            lancamentos_tbl.c.observacao.isnot(None),
            (
                lancamentos_tbl.c.observacao.like('%"lote_cartao_id"%')
                | lancamentos_tbl.c.observacao.like('%"grouped_card_launch"%')
                | lancamentos_tbl.c.observacao.like('%"is_sangria"%')
                | lancamentos_tbl.c.observacao.like('%"ifood_consolidado"%')
            )
        )
        results = conn.execute(query).fetchall()

        for row in results:
            lid = row[0]
            obs_raw = row[1]
            if not obs_raw or not isinstance(obs_raw, str):
                continue
            try:
                data = json.loads(obs_raw)
            except Exception:
                continue

            if not isinstance(data, dict):
                continue

            update_vals = {}
            if "lote_cartao_id" in data and isinstance(data["lote_cartao_id"], int):
                update_vals["lote_cartao_id"] = data["lote_cartao_id"]
                if data.get("conciliacao_faturamento"):
                    update_vals["tipo_origem"] = "PDV_CONCILIACAO_FATURAMENTO"
                elif data.get("conciliacao_taxa"):
                    update_vals["tipo_origem"] = "PDV_CONCILIACAO_TAXA"

            if data.get("grouped_card_launch"):
                update_vals["tipo_origem"] = "PDV_CARTAO_AGRUPADO"

            if data.get("is_sangria"):
                update_vals["tipo_origem"] = "PDV_SANGRIA_SAIDA"
                if data.get("sangria_uuid"):
                    update_vals["origem_uuid"] = str(data["sangria_uuid"])
            elif data.get("is_sangria_entrada"):
                update_vals["tipo_origem"] = "PDV_SANGRIA_ENTRADA"
                if data.get("sangria_uuid"):
                    update_vals["origem_uuid"] = str(data["sangria_uuid"])

            if data.get("ifood_consolidado"):
                update_vals["tipo_origem"] = "PDV_IFOOD_REPASSE"
            elif data.get("ifood_consolidado_taxa"):
                update_vals["tipo_origem"] = "PDV_IFOOD_TAXA"

            if update_vals:
                conn.execute(
                    lancamentos_tbl.update()
                    .where(lancamentos_tbl.c.id == lid)
                    .values(**update_vals)
                )
    except Exception as e:
        # Se falhar o backfill por qualquer motivo de banco, loga sem travar a migração de schema
        print(f"[Migration Warning] Backfill histórico finalizado com aviso: {e}")


def downgrade() -> None:
    try:
        op.drop_constraint('fk_lancamentos_lote_cartao_id_lotes_cartao', 'lancamentos', type_='foreignkey')
    except Exception:
        pass

    op.drop_index('ix_lancamentos_origem_uuid', table_name='lancamentos')
    op.drop_index('ix_lancamentos_tipo_origem', table_name='lancamentos')
    op.drop_index('ix_lancamentos_lote_cartao_id', table_name='lancamentos')

    op.drop_column('lancamentos', 'origem_uuid')
    op.drop_column('lancamentos', 'tipo_origem')
    op.drop_column('lancamentos', 'lote_cartao_id')

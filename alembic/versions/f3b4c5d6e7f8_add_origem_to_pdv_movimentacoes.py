"""add_origem_to_pdv_movimentacoes_and_ifood

Revision ID: f3b4c5d6e7f8
Revises: e2f3a4b5c6d7
Create Date: 2026-10-01
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


# revision identifiers, used by Alembic.
revision: str = 'f3b4c5d6e7f8'
down_revision: Union[str, None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar colunas de rastreamento de origem real em pdv_movimentacoes
    op.add_column('pdv_movimentacoes', sa.Column('origem_tipo', sa.String(length=50), nullable=True))
    op.add_column('pdv_movimentacoes', sa.Column('origem_id', sa.String(length=100), nullable=True))

    op.create_index('ix_pdv_movimentacoes_origem_tipo', 'pdv_movimentacoes', ['origem_tipo'], unique=False)
    op.create_index('ix_pdv_movimentacoes_origem_id', 'pdv_movimentacoes', ['origem_id'], unique=False)

    # 2. Adicionar colunas de rastreamento de origem real em pdv_ifood_lancamentos
    op.add_column('pdv_ifood_lancamentos', sa.Column('origem_tipo', sa.String(length=50), nullable=True))
    op.add_column('pdv_ifood_lancamentos', sa.Column('origem_id', sa.String(length=100), nullable=True))

    op.create_index('ix_pdv_ifood_lancamentos_origem_tipo', 'pdv_ifood_lancamentos', ['origem_tipo'], unique=False)
    op.create_index('ix_pdv_ifood_lancamentos_origem_id', 'pdv_ifood_lancamentos', ['origem_id'], unique=False)

    # 3. Backfill de registros legados baseado em vínculos reais do banco
    conn = op.get_bind()

    # (a) Movimentações do PDV Caixa Avulso (sem venda_id) -> pdv_movimentacao
    conn.execute(text("""
        UPDATE pdv_movimentacoes
        SET origem_tipo = 'pdv_movimentacao', origem_id = CAST(id AS VARCHAR)
        WHERE venda_id IS NULL AND (origem_tipo IS NULL OR origem_tipo = '')
    """))

    # (b) Movimentações vinculadas a vendas criadas pela Frente de Caixa (is_movimentacao_pdv = true nos lancamentos) -> pdv_movimentacao
    conn.execute(text("""
        UPDATE pdv_movimentacoes m
        SET origem_tipo = 'pdv_movimentacao', origem_id = CAST(m.id AS VARCHAR)
        WHERE m.venda_id IS NOT NULL 
          AND (m.origem_tipo IS NULL OR m.origem_tipo = '')
          AND EXISTS (
              SELECT 1 FROM lancamentos l 
              WHERE l.id_parcelamento = m.venda_id 
                AND l.observacao LIKE '%"is_movimentacao_pdv": true%'
          )
    """))

    # (b2) Vendas legadas da Frente de Caixa anteriores à flag is_movimentacao_pdv:
    #      a Movimentação PDV sempre cria a venda com um único item no produto genérico
    #      "Venda Geral" e nunca como venda direta. Vendas do PDV de itens usam produtos reais.
    conn.execute(text("""
        UPDATE pdv_movimentacoes m
        SET origem_tipo = 'pdv_movimentacao', origem_id = CAST(m.id AS VARCHAR)
        FROM pdv_vendas v
        WHERE v.id = m.venda_id
          AND (m.origem_tipo IS NULL OR m.origem_tipo = '')
          AND COALESCE(v.is_direct_sale, false) = false
          AND EXISTS (SELECT 1 FROM pdv_venda_itens i WHERE i.venda_id = v.id)
          AND NOT EXISTS (
              SELECT 1
              FROM pdv_venda_itens i
              JOIN produtos p ON p.id = i.produto_id
              WHERE i.venda_id = v.id AND p.nome <> 'Venda Geral'
          )
    """))

    # (c) Movimentações com venda_id restante (Vendas com itens do PDV) -> pdv_venda
    conn.execute(text("""
        UPDATE pdv_movimentacoes
        SET origem_tipo = 'pdv_venda', origem_id = venda_id
        WHERE venda_id IS NOT NULL AND (origem_tipo IS NULL OR origem_tipo = '')
    """))

    # (d) Lançamentos iFood legados -> pdv_ifood_lancamento com id do próprio lançamento
    conn.execute(text("""
        UPDATE pdv_ifood_lancamentos
        SET origem_tipo = 'pdv_ifood_lancamento', origem_id = CAST(id AS VARCHAR)
        WHERE origem_tipo IS NULL OR origem_tipo = ''
    """))


def downgrade() -> None:
    # 1. Remover colunas e índices de pdv_ifood_lancamentos
    op.drop_index('ix_pdv_ifood_lancamentos_origem_id', table_name='pdv_ifood_lancamentos')
    op.drop_index('ix_pdv_ifood_lancamentos_origem_tipo', table_name='pdv_ifood_lancamentos')
    op.drop_column('pdv_ifood_lancamentos', 'origem_id')
    op.drop_column('pdv_ifood_lancamentos', 'origem_tipo')

    # 2. Remover colunas e índices de pdv_movimentacoes
    op.drop_index('ix_pdv_movimentacoes_origem_id', table_name='pdv_movimentacoes')
    op.drop_index('ix_pdv_movimentacoes_origem_tipo', table_name='pdv_movimentacoes')
    op.drop_column('pdv_movimentacoes', 'origem_id')
    op.drop_column('pdv_movimentacoes', 'origem_tipo')

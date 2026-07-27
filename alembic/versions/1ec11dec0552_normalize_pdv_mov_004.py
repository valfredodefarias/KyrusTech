"""normalize_pdv_mov_004

Revision ID: 1ec11dec0552
Revises: da222fea69a9
Create Date: 2026-07-22

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '1ec11dec0552'
down_revision: Union[str, None] = 'da222fea69a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- PARTE 1: SCHEMA UPGRADE ---
    op.add_column('pdv_movimentacoes', sa.Column('numero_parcela', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('lote_cartao_itens', sa.Column('pdv_movimentacao_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_lote_cartao_itens_pdv_mov', 
        'lote_cartao_itens', 'pdv_movimentacoes', 
        ['pdv_movimentacao_id'], ['id'], 
        ondelete='CASCADE'
    )
    
    op.add_column('pdv_ifood_lancamentos', sa.Column('lancamento_consolidado_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_pdv_ifood_lancamentos_consolidado',
        'pdv_ifood_lancamentos', 'lancamentos',
        ['lancamento_consolidado_id'], ['id'],
        ondelete='SET NULL'
    )

    # --- PARTE 2: EXPLOSÃO HISTÓRICA E AJUSTES DE DATAS (SET-BASED POSTGRESQL) ---
    connection = op.get_bind()

    # Explosão de parcelas adicionais (2 a N) de movimentações parceladas
    connection.execute(sa.text("""
        INSERT INTO pdv_movimentacoes (
            created_at, updated_at, is_deleted, empresa_id, tipo, descricao, valor, 
            forma_pagamento, bandeira, parcelas, numero_parcela, data, centro_custo_id, 
            conta_id, conciliado, venda_id, import_hash
        )
        SELECT 
            NOW(), NOW(), false, pm.empresa_id, pm.tipo, 
            'Parcela ' || gs.i || '/' || pm.parcelas || ' - ' || pm.descricao,
            round(pm.valor / pm.parcelas, 2) + 
              CASE WHEN gs.i = pm.parcelas THEN (pm.valor - round(pm.valor / pm.parcelas, 2) * pm.parcelas) ELSE 0 END,
            pm.forma_pagamento, pm.bandeira, pm.parcelas, gs.i,
            pm.data + (CASE WHEN pm.forma_pagamento ILIKE '%debito%' THEN INTERVAL '1 day' ELSE gs.i * INTERVAL '1 month' END),
            pm.centro_custo_id, pm.conta_id, pm.conciliado, pm.venda_id,
            CASE WHEN pm.import_hash IS NOT NULL THEN pm.import_hash || '-P' || gs.i ELSE NULL END
        FROM pdv_movimentacoes pm
        CROSS JOIN LATERAL generate_series(2, pm.parcelas) AS gs(i)
        WHERE pm.parcelas > 1 AND pm.numero_parcela = 1;
    """))

    # Ajuste de valor e data da primeira parcela
    connection.execute(sa.text("""
        UPDATE pdv_movimentacoes 
        SET 
            valor = round(valor / parcelas, 2),
            data = data + (CASE WHEN forma_pagamento ILIKE '%debito%' THEN INTERVAL '1 day' ELSE INTERVAL '1 month' END)
        WHERE parcelas > 1 AND numero_parcela = 1;
    """))

    # Remapeamento de lote_cartao_itens - Query 1: Via id_parcelamento (venda_id UUID)
    connection.execute(sa.text("""
        UPDATE lote_cartao_itens lci
        SET pdv_movimentacao_id = pm.id
        FROM lancamentos l
        JOIN pdv_movimentacoes pm ON pm.venda_id = l.id_parcelamento
        WHERE l.id = lci.lancamento_id
          AND l.origem = 'PDV'
          AND l.id_parcelamento IS NOT NULL
          AND pm.numero_parcela = COALESCE(l.numero_parcela, 1)
          AND pm.forma_pagamento IN ('CREDITO_AVISTA', 'CREDITO_PARCELADO', 'DEBITO');
    """))

    # Remapeamento de lote_cartao_itens - Query 2: Via pdv_venda_id chave no JSON observacao
    connection.execute(sa.text("""
        UPDATE lote_cartao_itens lci
        SET pdv_movimentacao_id = pm.id
        FROM lancamentos l
        JOIN pdv_movimentacoes pm ON pm.venda_id = substring(l.observacao from '"pdv_venda_id"\s*:\s*"([^"]+)"')
        WHERE l.id = lci.lancamento_id
          AND lci.pdv_movimentacao_id IS NULL
          AND l.origem = 'PDV'
          AND l.observacao LIKE '%"pdv_venda_id"%'
          AND pm.numero_parcela = COALESCE((substring(l.observacao from '"numero_parcela"\s*:\s*([0-9]+)')::int), 1)
          AND pm.forma_pagamento IN ('CREDITO_AVISTA', 'CREDITO_PARCELADO', 'DEBITO');
    """))

    # Remapeamento de lote_cartao_itens - Query 3: Via rv no JSON observacao mapeando a pdv_vendas
    connection.execute(sa.text("""
        UPDATE lote_cartao_itens lci
        SET pdv_movimentacao_id = pm.id
        FROM lancamentos l
        JOIN pdv_vendas pv ON pv.rv = substring(l.observacao from '"rv"\s*:\s*"([^"]+)"') AND pv.empresa_id = l.empresa_id
        JOIN pdv_movimentacoes pm ON pm.venda_id = pv.id
        WHERE l.id = lci.lancamento_id
          AND lci.pdv_movimentacao_id IS NULL
          AND l.origem = 'PDV'
          AND l.observacao LIKE '%"rv"%'
          AND pm.numero_parcela = COALESCE((substring(l.observacao from '"numero_parcela"\s*:\s*([0-9]+)')::int), 1)
          AND pm.forma_pagamento IN ('CREDITO_AVISTA', 'CREDITO_PARCELADO', 'DEBITO');
    """))

    # --- PARTE 3: SCHEMA CLEANUP ---
    op.drop_constraint('lote_cartao_itens_lancamento_id_fkey', 'lote_cartao_itens', type_='foreignkey')
    op.drop_column('lote_cartao_itens', 'lancamento_id')
    op.create_index('ix_pdv_movimentacoes_conciliado_fast', 'pdv_movimentacoes', ['empresa_id', 'conciliado', 'data'])


def downgrade() -> None:
    op.add_column('lote_cartao_itens', sa.Column('lancamento_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'lote_cartao_itens_lancamento_id_fkey', 
        'lote_cartao_itens', 'lancamentos', 
        ['lancamento_id'], ['id']
    )
    op.drop_constraint('fk_lote_cartao_itens_pdv_mov', 'lote_cartao_itens', type_='foreignkey')
    op.drop_column('lote_cartao_itens', 'pdv_movimentacao_id')
    op.drop_column('pdv_movimentacoes', 'numero_parcela')
    op.drop_index('ix_pdv_movimentacoes_conciliado_fast')
    
    op.drop_constraint('fk_pdv_ifood_lancamentos_consolidado', 'pdv_ifood_lancamentos', type_='foreignkey')
    op.drop_column('pdv_ifood_lancamentos', 'lancamento_consolidado_id')
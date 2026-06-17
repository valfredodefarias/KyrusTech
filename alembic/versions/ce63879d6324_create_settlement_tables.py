"""create_settlement_tables

Revision ID: ce63879d6324
Revises: 226b4c1e34d9
Create Date: 2026-06-16 02:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = 'ce63879d6324'
down_revision: Union[str, None] = '226b4c1e34d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Criar tabela movimentos_ofx
    op.create_table('movimentos_ofx',
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by_id', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('descricao', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('valor', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('tipo', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('import_hash', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='ABERTO'),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.Column('conta_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['conta_id'], ['contas.id'], ),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_movimentos_ofx_descricao'), 'movimentos_ofx', ['descricao'], unique=False)
    op.create_index(op.f('ix_movimentos_ofx_tipo'), 'movimentos_ofx', ['tipo'], unique=False)
    op.create_index(op.f('ix_movimentos_ofx_data'), 'movimentos_ofx', ['data'], unique=False)
    op.create_index(op.f('ix_movimentos_ofx_import_hash'), 'movimentos_ofx', ['import_hash'], unique=True)
    op.create_index(op.f('ix_movimentos_ofx_status'), 'movimentos_ofx', ['status'], unique=False)
    op.create_index(op.f('ix_movimentos_ofx_empresa_id'), 'movimentos_ofx', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_movimentos_ofx_conta_id'), 'movimentos_ofx', ['conta_id'], unique=False)

    # 2. Criar tabela baixas
    op.create_table('baixas',
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by_id', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lancamento_id', sa.Integer(), nullable=False),
        sa.Column('movimento_ofx_id', sa.Integer(), nullable=False),
        sa.Column('valor_pago', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('data_baixa', sa.Date(), nullable=False),
        sa.Column('tipo_baixa', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='PRINCIPAL'),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], ),
        sa.ForeignKeyConstraint(['lancamento_id'], ['lancamentos.id'], ),
        sa.ForeignKeyConstraint(['movimento_ofx_id'], ['movimentos_ofx.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_baixas_lancamento_id'), 'baixas', ['lancamento_id'], unique=False)
    op.create_index(op.f('ix_baixas_movimento_ofx_id'), 'baixas', ['movimento_ofx_id'], unique=False)
    op.create_index(op.f('ix_baixas_data_baixa'), 'baixas', ['data_baixa'], unique=False)
    op.create_index(op.f('ix_baixas_tipo_baixa'), 'baixas', ['tipo_baixa'], unique=False)
    op.create_index(op.f('ix_baixas_empresa_id'), 'baixas', ['empresa_id'], unique=False)

    # 3. Fase DML - Migração dos dados legados
    op.execute("""
        -- Primeiro inserir os movimentos_ofx
        INSERT INTO movimentos_ofx (
            created_at, updated_at, is_deleted, descricao, valor, tipo, data, import_hash, status, empresa_id, conta_id
        )
        SELECT 
            NOW(),
            NOW(),
            FALSE,
            l.descricao,
            l.valor_pago,
            l.tipo,
            COALESCE(l.data_pagamento, l.data_vencimento),
            l.import_hash,
            'CONCILIADO',
            l.empresa_id,
            COALESCE(l.conta_id, (SELECT id FROM contas WHERE empresa_id = l.empresa_id LIMIT 1))
        FROM (
            SELECT DISTINCT ON (import_hash) descricao, valor_pago, tipo, data_pagamento, data_vencimento, import_hash, empresa_id, conta_id
            FROM lancamentos
            WHERE conciliado = TRUE AND import_hash IS NOT NULL AND import_hash <> ''
        ) l
        ON CONFLICT (import_hash) DO NOTHING;
    """)

    op.execute("""
        -- Segundo inserir as baixas associadas
        INSERT INTO baixas (
            created_at, updated_at, is_deleted, lancamento_id, movimento_ofx_id, valor_pago, data_baixa, tipo_baixa, empresa_id
        )
        SELECT
            NOW(),
            NOW(),
            FALSE,
            l.id,
            m.id,
            l.valor_pago,
            COALESCE(l.data_pagamento, l.data_vencimento, CURRENT_DATE),
            'PRINCIPAL',
            l.empresa_id
        FROM lancamentos l
        JOIN movimentos_ofx m ON m.import_hash = l.import_hash
        WHERE l.conciliado = TRUE AND l.import_hash IS NOT NULL AND l.import_hash <> '';
    """)

    # 4. Atualizar o status dos lançamentos migrados para 'PAGO' se já estão conciliados
    op.execute("""
        UPDATE lancamentos
        SET status = 'PAGO'
        WHERE conciliado = TRUE AND status <> 'PAGO';
    """)

def downgrade() -> None:
    # Remover baixas e movimentos_ofx
    op.drop_index(op.f('ix_baixas_empresa_id'), table_name='baixas')
    op.drop_index(op.f('ix_baixas_tipo_baixa'), table_name='baixas')
    op.drop_index(op.f('ix_baixas_data_baixa'), table_name='baixas')
    op.drop_index(op.f('ix_baixas_movimento_ofx_id'), table_name='baixas')
    op.drop_index(op.f('ix_baixas_lancamento_id'), table_name='baixas')
    op.drop_table('baixas')

    op.drop_index(op.f('ix_movimentos_ofx_conta_id'), table_name='movimentos_ofx')
    op.drop_index(op.f('ix_movimentos_ofx_empresa_id'), table_name='movimentos_ofx')
    op.drop_index(op.f('ix_movimentos_ofx_status'), table_name='movimentos_ofx')
    op.drop_index(op.f('ix_movimentos_ofx_import_hash'), table_name='movimentos_ofx')
    op.drop_index(op.f('ix_movimentos_ofx_data'), table_name='movimentos_ofx')
    op.drop_index(op.f('ix_movimentos_ofx_tipo'), table_name='movimentos_ofx')
    op.drop_index(op.f('ix_movimentos_ofx_descricao'), table_name='movimentos_ofx')
    op.drop_table('movimentos_ofx')
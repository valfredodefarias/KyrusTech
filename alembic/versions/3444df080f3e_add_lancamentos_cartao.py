"""Add lancamentos_cartao"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3444df080f3e'
down_revision: Union[str, None] = '2e78abbbc5ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    # Criação da tabela
    op.create_table(
        'lancamentos_cartao',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('descricao', sa.String(), nullable=False),
        sa.Column('valor', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('data_compra', sa.Date(), nullable=False),
        sa.Column('data_vencimento_fatura', sa.Date(), nullable=False),
        sa.Column('competencia_fatura', sa.String(), nullable=False),
        sa.Column('numero_parcela', sa.Integer(), nullable=True),
        sa.Column('id_parcelamento', sa.String(), nullable=True),
        sa.Column('observacao', sa.String(), nullable=True),
        sa.Column('import_hash', sa.String(), nullable=True),
        sa.Column('ofx_bank_id', sa.String(), nullable=True),
        sa.Column('fatura_paga', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.Column('cartao_id', sa.Integer(), nullable=False),
        sa.Column('plano_contas_id', sa.Integer(), nullable=False),
        sa.Column('centro_custo_id', sa.Integer(), nullable=True),
        sa.Column('entidade_id', sa.Integer(), nullable=True),
        sa.Column('lancamento_pagamento_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['cartao_id'], ['cartoes.id'], ),
        sa.ForeignKeyConstraint(['centro_custo_id'], ['centros_custo.id'], ),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], ),
        sa.ForeignKeyConstraint(['entidade_id'], ['entidades.id'], ),
        sa.ForeignKeyConstraint(['lancamento_pagamento_id'], ['lancamentos.id'], ),
        sa.ForeignKeyConstraint(['plano_contas_id'], ['plano_contas.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Índices
    op.create_index(op.f('ix_lancamentos_cartao_cartao_id'), 'lancamentos_cartao', ['cartao_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_centro_custo_id'), 'lancamentos_cartao', ['centro_custo_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_competencia_fatura'), 'lancamentos_cartao', ['competencia_fatura'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_data_compra'), 'lancamentos_cartao', ['data_compra'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_data_vencimento_fatura'), 'lancamentos_cartao', ['data_vencimento_fatura'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_descricao'), 'lancamentos_cartao', ['descricao'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_empresa_id'), 'lancamentos_cartao', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_entidade_id'), 'lancamentos_cartao', ['entidade_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_fatura_paga'), 'lancamentos_cartao', ['fatura_paga'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_id_parcelamento'), 'lancamentos_cartao', ['id_parcelamento'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_import_hash'), 'lancamentos_cartao', ['import_hash'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_lancamento_pagamento_id'), 'lancamentos_cartao', ['lancamento_pagamento_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_ofx_bank_id'), 'lancamentos_cartao', ['ofx_bank_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_cartao_plano_contas_id'), 'lancamentos_cartao', ['plano_contas_id'], unique=False)

    # Migração dos dados: Copia lançamentos de cartão para a nova tabela
    # Assumindo que cartao_id IS NOT NULL identifica despesas de cartão
    op.execute("""
        INSERT INTO lancamentos_cartao (
            descricao, valor, data_compra, data_vencimento_fatura, competencia_fatura,
            numero_parcela, id_parcelamento, observacao, import_hash, ofx_bank_id,
            fatura_paga, empresa_id, cartao_id, plano_contas_id, centro_custo_id,
            entidade_id, created_at, updated_at
        )
        SELECT 
            descricao,
            valor_previsto,
            data_competencia,
            data_vencimento,
            COALESCE(competencia, TO_CHAR(data_vencimento, 'YYYY-MM')),
            numero_parcela,
            id_parcelamento,
            observacao,
            import_hash,
            ofx_bank_id,
            CASE WHEN status = 'PAGO' THEN true ELSE false END,
            empresa_id,
            cartao_id,
            plano_contas_id,
            centro_custo_id,
            entidade_id,
            created_at,
            updated_at
        FROM lancamentos
        WHERE cartao_id IS NOT NULL AND deleted_at IS NULL
    """)
    
    # Limpa da tabela financeira
    op.execute("""
        UPDATE lancamentos
        SET deleted_at = NOW()
        WHERE cartao_id IS NOT NULL AND deleted_at IS NULL
    """)

def downgrade() -> None:
    # Restaura lançamentos
    op.execute("""
        UPDATE lancamentos
        SET deleted_at = NULL
        WHERE cartao_id IS NOT NULL AND deleted_at IS NOT NULL
    """)
    
    op.drop_index(op.f('ix_lancamentos_cartao_plano_contas_id'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_ofx_bank_id'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_lancamento_pagamento_id'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_import_hash'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_id_parcelamento'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_fatura_paga'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_entidade_id'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_empresa_id'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_descricao'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_data_vencimento_fatura'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_data_compra'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_competencia_fatura'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_centro_custo_id'), table_name='lancamentos_cartao')
    op.drop_index(op.f('ix_lancamentos_cartao_cartao_id'), table_name='lancamentos_cartao')
    op.drop_table('lancamentos_cartao')
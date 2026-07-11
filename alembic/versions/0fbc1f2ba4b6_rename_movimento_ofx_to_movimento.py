"""rename_movimento_ofx_to_movimento"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0fbc1f2ba4b6'
down_revision: Union[str, None] = 'cb9c5f9bf0fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
from sqlalchemy import text
from datetime import datetime

def upgrade() -> None:
    # 1. Renomear tabela movimentos_ofx -> movimentos
    op.rename_table('movimentos_ofx', 'movimentos')
    
    # 2. Adicionar coluna origem com valor default "OFX"
    op.add_column('movimentos', sa.Column('origem', sa.String(), nullable=False, server_default='OFX'))
    
    # 3. Renomear coluna movimento_ofx_id -> movimento_id na tabela baixas
    op.alter_column('baixas', 'movimento_ofx_id', new_column_name='movimento_id')

    # 4. Criar tabela alertas_anomalia
    op.create_table(
        'alertas_anomalia',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by_id', sa.Integer(), nullable=True),
        sa.Column('tipo_objeto', sa.String(), nullable=False),
        sa.Column('objeto_id', sa.Integer(), nullable=False),
        sa.Column('tipo_anomalia', sa.String(), nullable=False),
        sa.Column('gravidade', sa.String(), nullable=False, server_default='ALTA'),
        sa.Column('descricao', sa.String(), nullable=False),
        sa.Column('dados_extras', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='PENDENTE'),
        sa.Column('motivo_resolucao', sa.String(), nullable=True),
        sa.Column('resolvido_por_id', sa.Integer(), nullable=True),
        sa.Column('resolvido_em', sa.DateTime(), nullable=True),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], ),
        sa.ForeignKeyConstraint(['resolvido_por_id'], ['usuarios.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_alertas_anomalia_tipo_objeto'), 'alertas_anomalia', ['tipo_objeto'], unique=False)
    op.create_index(op.f('ix_alertas_anomalia_objeto_id'), 'alertas_anomalia', ['objeto_id'], unique=False)
    op.create_index(op.f('ix_alertas_anomalia_tipo_anomalia'), 'alertas_anomalia', ['tipo_anomalia'], unique=False)
    op.create_index(op.f('ix_alertas_anomalia_gravidade'), 'alertas_anomalia', ['gravidade'], unique=False)
    op.create_index(op.f('ix_alertas_anomalia_status'), 'alertas_anomalia', ['status'], unique=False)
    op.create_index(op.f('ix_alertas_anomalia_empresa_id'), 'alertas_anomalia', ['empresa_id'], unique=False)

    # 5. Executar Backfill de Lançamentos Pagos Históricos (Sem baixas)
    _backfill_manual_payments()


def downgrade() -> None:
    # 1. Remover tabela alertas_anomalia e índices
    op.drop_index(op.f('ix_alertas_anomalia_status'), table_name='alertas_anomalia')
    op.drop_index(op.f('ix_alertas_anomalia_tipo_anomalia'), table_name='alertas_anomalia')
    op.drop_index(op.f('ix_alertas_anomalia_tipo_objeto'), table_name='alertas_anomalia')
    op.drop_index(op.f('ix_alertas_anomalia_objeto_id'), table_name='alertas_anomalia')
    op.drop_index(op.f('ix_alertas_anomalia_gravidade'), table_name='alertas_anomalia')
    op.drop_index(op.f('ix_alertas_anomalia_empresa_id'), table_name='alertas_anomalia')
    op.drop_table('alertas_anomalia')

    # 2. Desfazer movimentos criados no Backfill
    bind = op.get_bind()
    from sqlalchemy.orm import Session
    session = Session(bind=bind)
    try:
        session.execute(text("""
            DELETE FROM baixas 
            WHERE movimento_id IN (SELECT id FROM movimentos WHERE origem = 'MANUAL')
        """))
        session.execute(text("DELETE FROM movimentos WHERE origem = 'MANUAL'"))
        session.commit()
    except Exception as exc:
        session.rollback()
        print(f"[WARN] Erro durante rollback do backfill: {exc}")

    # 3. Desfazer renomeações de colunas e tabelas
    op.alter_column('baixas', 'movimento_id', new_column_name='movimento_ofx_id')
    op.drop_column('movimentos', 'origem')
    op.rename_table('movimentos', 'movimentos_ofx')


def _backfill_manual_payments() -> None:
    from sqlalchemy.orm import Session
    from decimal import Decimal

    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        sql_launches = text("""
            SELECT id, descricao, tipo, valor_pago, valor_previsto, data_pagamento, conta_id, empresa_id
            FROM lancamentos
            WHERE is_deleted = FALSE 
              AND (status = 'PAGO' OR data_pagamento IS NOT NULL)
              AND id NOT IN (SELECT DISTINCT lancamento_id FROM baixas)
        """)
        
        results = session.execute(sql_launches).fetchall()
        now = datetime.utcnow()
        
        for row in results:
            lanc_id = row.id
            descricao = row.descricao
            tipo = row.tipo
            valor_pago = row.valor_pago or row.valor_previsto or Decimal("0.00")
            data_pagamento = row.data_pagamento
            conta_id = row.conta_id
            empresa_id = row.empresa_id
            
            if not data_pagamento:
                data_pagamento = now.date()
                
            if not conta_id:
                first_conta_sql = text("SELECT id FROM contas WHERE empresa_id = :empresa_id AND is_deleted = FALSE LIMIT 1")
                first_conta = session.execute(first_conta_sql, {"empresa_id": empresa_id}).scalar()
                if first_conta:
                    conta_id = first_conta
                else:
                    insert_conta_sql = text("""
                        INSERT INTO contas (nome, tipo, saldo_inicial, status, empresa_id, conta_como_disponibilidade, created_at, updated_at, is_deleted)
                        VALUES ('Caixa Física', 'CAIXA', 0.00, 'ATIVO', :empresa_id, TRUE, :now, :now, FALSE)
                        RETURNING id
                    """)
                    conta_id = session.execute(insert_conta_sql, {"empresa_id": empresa_id, "now": now}).scalar()
            
            import_hash = f"manual:{lanc_id}:{datetime.utcnow().timestamp()}"
            
            insert_mov_sql = text("""
                INSERT INTO movimentos (descricao, valor, tipo, data, import_hash, status, origem, empresa_id, conta_id, created_at, updated_at, is_deleted)
                VALUES (:descricao, :valor, :tipo, :data, :import_hash, 'CONCILIADO', 'MANUAL', :empresa_id, :conta_id, :now, :now, FALSE)
                RETURNING id
            """)
            
            mov_id = session.execute(insert_mov_sql, {
                "descricao": f"Pagamento: {descricao}",
                "valor": valor_pago,
                "tipo": tipo,
                "data": data_pagamento,
                "import_hash": import_hash,
                "empresa_id": empresa_id,
                "conta_id": conta_id,
                "now": now
            }).scalar()
            
            insert_baixa_sql = text("""
                INSERT INTO baixas (lancamento_id, movimento_id, valor_pago, data_baixa, tipo_baixa, empresa_id, created_at, updated_at, is_deleted)
                VALUES (:lancamento_id, :movimento_id, :valor_pago, :data_baixa, 'PRINCIPAL', :empresa_id, :now, :now, FALSE)
            """)
            
            session.execute(insert_baixa_sql, {
                "lancamento_id": lanc_id,
                "movimento_id": mov_id,
                "valor_pago": valor_pago,
                "data_baixa": data_pagamento,
                "empresa_id": empresa_id,
                "now": now
            })

            
        session.commit()
    except Exception as exc:
        session.rollback()
        print(f"[WARN] Error during manual payments backfill: {exc}")
        raise exc
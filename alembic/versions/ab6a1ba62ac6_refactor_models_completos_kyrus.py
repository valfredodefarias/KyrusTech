"""Refactor models completos kyrus"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = 'ab6a1ba62ac6'
down_revision: Union[str, None] = '8763be75dfba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. CRIAÇÃO DE TABELAS NOVAS (Audit e Anexos)
    op.create_table('audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('table_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('record_id', sa.Integer(), nullable=False),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('changes', sa.JSON(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('ip_address', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('user_agent', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_audit_logs_record_id'), 'audit_logs', ['record_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_table_name'), 'audit_logs', ['table_name'], unique=False)
    op.create_index(op.f('ix_audit_logs_user_id'), 'audit_logs', ['user_id'], unique=False)
    
    op.create_table('anexos_lancamento',
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by_id', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nome_arquivo', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('url', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('tipo', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('tamanho_bytes', sa.Integer(), nullable=True),
        sa.Column('content_type', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('lancamento_id', sa.Integer(), nullable=False),
        sa.Column('empresa_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['empresa_id'], ['empresas.id'], ),
        sa.ForeignKeyConstraint(['lancamento_id'], ['lancamentos.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_anexos_lancamento_empresa_id'), 'anexos_lancamento', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_anexos_lancamento_is_deleted'), 'anexos_lancamento', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_anexos_lancamento_lancamento_id'), 'anexos_lancamento', ['lancamento_id'], unique=False)
    op.create_index(op.f('ix_anexos_lancamento_nome_arquivo'), 'anexos_lancamento', ['nome_arquivo'], unique=False)
    op.create_index(op.f('ix_anexos_lancamento_tipo'), 'anexos_lancamento', ['tipo'], unique=False)
    
    # 2. CARTOES - Adicionando Auditoria
    op.add_column('cartoes', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('cartoes', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('cartoes', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('cartoes', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('cartoes', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('cartoes', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('cartoes', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_cartoes_empresa_id'), 'cartoes', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_cartoes_is_deleted'), 'cartoes', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_cartoes_nome_cartao'), 'cartoes', ['nome_cartao'], unique=False)
    op.create_index(op.f('ix_cartoes_status'), 'cartoes', ['status'], unique=False)
    op.drop_column('cartoes', 'id_conta_padrao')
    
    # 3. CENTROS CUSTO - Adicionando Auditoria
    op.add_column('centros_custo', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('centros_custo', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('centros_custo', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('centros_custo', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('centros_custo', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('centros_custo', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('centros_custo', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_centros_custo_empresa_id'), 'centros_custo', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_centros_custo_is_deleted'), 'centros_custo', ['is_deleted'], unique=False)
    
    # 4. CONTAS - Adicionando Auditoria e Tipo Integração
    op.add_column('contas', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('contas', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('contas', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('contas', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('contas', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('contas', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('contas', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.add_column('contas', sa.Column('tipo_integracao', sqlmodel.sql.sqltypes.AutoString(), server_default='MANUAL', nullable=False))
    # Alterando saldo de Float para Numeric/Decimal
    op.alter_column('contas', 'saldo_inicial',
               existing_type=sa.DOUBLE_PRECISION(precision=53),
               type_=sa.Numeric(precision=15, scale=2),
               existing_nullable=False)
    op.create_index(op.f('ix_contas_empresa_id'), 'contas', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_contas_is_deleted'), 'contas', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_contas_status'), 'contas', ['status'], unique=False)
    op.create_index(op.f('ix_contas_tipo_integracao'), 'contas', ['tipo_integracao'], unique=False)
    
    # 5. EMPRESAS - Adicionando Auditoria
    op.add_column('empresas', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('empresas', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('empresas', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('empresas', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('empresas', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('empresas', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_empresas_is_deleted'), 'empresas', ['is_deleted'], unique=False)
    
    # 6. ENTIDADES - Adicionando Auditoria
    op.add_column('entidades', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('entidades', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('entidades', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('entidades', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('entidades', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('entidades', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('entidades', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_entidades_cpf_cnpj'), 'entidades', ['cpf_cnpj'], unique=False)
    op.create_index(op.f('ix_entidades_empresa_id'), 'entidades', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_entidades_is_deleted'), 'entidades', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_entidades_tipo'), 'entidades', ['tipo'], unique=False)
    
    # 7. INTEGRACAO - Ajustes de campos e Auditoria
    op.add_column('integracoes_bancarias', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('integracoes_bancarias', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('integracoes_bancarias', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('integracoes_bancarias', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('integracoes_bancarias', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.add_column('integracoes_bancarias', sa.Column('provedor', sqlmodel.sql.sqltypes.AutoString(), server_default='OUTROS', nullable=False))
    
    # Tornar conta_id obrigatório e único para integração
    op.alter_column('integracoes_bancarias', 'conta_id',
               existing_type=sa.INTEGER(),
               nullable=False)
    op.create_index(op.f('ix_integracoes_bancarias_conta_id'), 'integracoes_bancarias', ['conta_id'], unique=True)
    op.create_index(op.f('ix_integracoes_bancarias_empresa_id'), 'integracoes_bancarias', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_integracoes_bancarias_is_deleted'), 'integracoes_bancarias', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_integracoes_bancarias_provedor'), 'integracoes_bancarias', ['provedor'], unique=False)
    
    # Remover colunas antigas ou renomeadas
    op.drop_constraint('integracoes_bancarias_centro_custo_id_fkey', 'integracoes_bancarias', type_='foreignkey')
    op.drop_constraint('integracoes_bancarias_categoria_padrao_id_fkey', 'integracoes_bancarias', type_='foreignkey')
    op.drop_column('integracoes_bancarias', 'intervalo_sincronizacao_minutos')
    op.drop_column('integracoes_bancarias', 'categoria_padrao_id')
    op.drop_column('integracoes_bancarias', 'tipo')
    op.drop_column('integracoes_bancarias', 'proxima_sincronizacao')
    op.drop_column('integracoes_bancarias', 'centro_custo_id')
    op.drop_column('integracoes_bancarias', 'ultima_sincronizacao')
    op.drop_column('integracoes_bancarias', 'usar_categoria_a_categorizar')
    
    # 8. LANCAMENTOS - Auditoria
    op.add_column('lancamentos', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('lancamentos', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('lancamentos', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('lancamentos', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('lancamentos', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('lancamentos', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('lancamentos', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_lancamentos_cartao_id'), 'lancamentos', ['cartao_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_centro_custo_id'), 'lancamentos', ['centro_custo_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_conta_id'), 'lancamentos', ['conta_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_empresa_id'), 'lancamentos', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_entidade_id'), 'lancamentos', ['entidade_id'], unique=False)
    op.create_index(op.f('ix_lancamentos_is_deleted'), 'lancamentos', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_lancamentos_plano_contas_id'), 'lancamentos', ['plano_contas_id'], unique=False)
    op.drop_column('lancamentos', 'anexo_url')
    
    # 9. MAPEAMENTOS - Auditoria
    op.add_column('mapeamentos_categoria', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('mapeamentos_categoria', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('mapeamentos_categoria', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('mapeamentos_categoria', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('mapeamentos_categoria', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('mapeamentos_categoria', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('mapeamentos_categoria', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_mapeamentos_categoria_is_deleted'), 'mapeamentos_categoria', ['is_deleted'], unique=False)
    
    # 10. PLANO CONTAS - Auditoria e Novos Campos
    op.add_column('plano_contas', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('plano_contas', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('plano_contas', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('plano_contas', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('plano_contas', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('plano_contas', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('plano_contas', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.add_column('plano_contas', sa.Column('eh_cabecalho', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('plano_contas', sa.Column('eh_divida', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.create_index(op.f('ix_plano_contas_codigo'), 'plano_contas', ['codigo'], unique=False)
    op.create_index(op.f('ix_plano_contas_empresa_id'), 'plano_contas', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_plano_contas_is_deleted'), 'plano_contas', ['is_deleted'], unique=False)
    
    # 11. USUARIOS - Auditoria
    op.add_column('usuarios', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('usuarios', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('usuarios', sa.Column('created_by_id', sa.Integer(), nullable=True))
    op.add_column('usuarios', sa.Column('updated_by_id', sa.Integer(), nullable=True))
    op.add_column('usuarios', sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('usuarios', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('usuarios', sa.Column('deleted_by_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_usuarios_empresa_id'), 'usuarios', ['empresa_id'], unique=False)
    op.create_index(op.f('ix_usuarios_is_deleted'), 'usuarios', ['is_deleted'], unique=False)


def downgrade() -> None:
    # Reversão básica para permitir voltar se necessário
    # NOTA: Dropar colunas em tabelas grandes pode ser lento.
    
    op.drop_column('usuarios', 'is_deleted')
    op.drop_column('usuarios', 'created_at')
    op.drop_column('usuarios', 'updated_at')
    
    op.drop_column('plano_contas', 'eh_cabecalho')
    op.drop_column('plano_contas', 'is_deleted')
    
    op.drop_column('mapeamentos_categoria', 'is_deleted')
    
    op.add_column('lancamentos', sa.Column('anexo_url', sa.VARCHAR(), autoincrement=False, nullable=True))
    op.drop_column('lancamentos', 'is_deleted')
    
    # ... (simplificado para focar na correção do upgrade) ...
    # Se precisar de um downgrade completo e rigoroso, precisa mapear todos os drops inversos.
    # Mas para o erro atual, o foco é o upgrade funcionar.
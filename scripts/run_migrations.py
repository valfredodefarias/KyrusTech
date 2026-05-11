#!/usr/bin/env python3
"""
Script para executar migrations do Alembic automaticamente
Executado na inicialização do container
"""

import sys
import os
from pathlib import Path
from subprocess import run, PIPE
from sqlalchemy import create_engine, text
from sqlmodel import Session

# Adicionar raiz ao path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))


def apply_legacy_schema_compatibility() -> None:
    from app.core.config import settings
    from app.models.consultor_empresa import ConsultorEmpresa
    from app.models.plano_contas_template_config import PlanoContasTemplateConfig

    engine = create_engine(settings.DATABASE_URL)
    statements = [
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS tipo_pessoa VARCHAR DEFAULT 'PJ'",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS nome_fantasia VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS email VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS telefone VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS celular VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS contato_nome VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS cep VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS logradouro VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS numero VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS complemento VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS bairro VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS cidade VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS uf VARCHAR(2)",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS observacoes TEXT",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo_pessoa VARCHAR DEFAULT 'PJ'",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS categoria_nfe_fornecedores_id INTEGER",
        "CREATE INDEX IF NOT EXISTS ix_empresas_categoria_nfe_fornecedores_id ON empresas (categoria_nfe_fornecedores_id)",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS agencia VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_numero VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_digito VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS logo_url VARCHAR",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS considerar_nos_resultados BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS eh_divida BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS oculta BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_como_disponibilidade BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome VARCHAR",
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url VARCHAR",
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS consultor_role VARCHAR NOT NULL DEFAULT 'USUARIO_NORMAL'",
        "ALTER TABLE usuarios ALTER COLUMN empresa_id DROP NOT NULL",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS previsto BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS competencia VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS import_hash VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS movimento_uid VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS referencia_externa VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_movimento_uid ON lancamentos (movimento_uid)",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_referencia_externa ON lancamentos (referencia_externa)",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS intervalo_sincronizacao_minutos INTEGER NOT NULL DEFAULT 60",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS data_inicio_sincronizacao DATE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS ultima_sincronizacao TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS proxima_sincronizacao TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS categoria_padrao_id INTEGER",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS usar_categoria_a_categorizar BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS centro_custo_id INTEGER",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS eh_operacional BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS dre_grupo VARCHAR NOT NULL DEFAULT 'DESPESAS_OPERACIONAIS'",
        "UPDATE entidades SET tipo_pessoa = CASE WHEN upper(coalesce(cpf_cnpj, '')) ~ '^[0-9]{12,}$' THEN 'PJ' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_FISICA', 'PF') THEN 'PF' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_JURIDICA', 'PJ') THEN 'PJ' ELSE coalesce(tipo_pessoa, 'PJ') END WHERE tipo_pessoa IS NULL OR trim(tipo_pessoa) = ''",
        "UPDATE entidades SET tipo = CASE WHEN upper(coalesce(tipo, '')) IN ('CLIENTE', 'FORNECEDOR', 'AMBOS') THEN upper(tipo) ELSE 'AMBOS' END WHERE tipo IS NULL OR upper(coalesce(tipo, '')) NOT IN ('CLIENTE', 'FORNECEDOR', 'AMBOS')",
        "CREATE INDEX IF NOT EXISTS ix_entidades_tipo_pessoa ON entidades (tipo_pessoa)",
        "ALTER TABLE cartoes ADD COLUMN IF NOT EXISTS bandeira VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_cartoes_bandeira ON cartoes (bandeira)",
        "UPDATE plano_contas SET oculta = FALSE WHERE oculta IS NULL",
        "CREATE INDEX IF NOT EXISTS ix_plano_contas_oculta ON plano_contas (oculta)",
        "UPDATE plano_contas SET considerar_nos_resultados = TRUE WHERE coalesce(oculta, FALSE) = FALSE",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS transferencia_grupo_id VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_transferencia_grupo_id ON lancamentos (transferencia_grupo_id)",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))

    ConsultorEmpresa.__table__.create(bind=engine, checkfirst=True)
    PlanoContasTemplateConfig.__table__.create(bind=engine, checkfirst=True)


def ensure_rbac_defaults() -> dict[str, int]:
    from app.services.access_seed_service import ensure_rbac_seed

    from app.core.config import settings

    engine = create_engine(settings.DATABASE_URL)
    with Session(engine) as session:
        return ensure_rbac_seed(session)


def ensure_integracoes_scheduler_schema() -> None:
    """Garante colunas exigidas pelo scheduler quando o schema estiver com drift."""
    from app.core.config import settings

    engine = create_engine(settings.DATABASE_URL)
    statements = [
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS data_inicio_sincronizacao DATE",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS categoria_nfe_fornecedores_id INTEGER",
        "CREATE INDEX IF NOT EXISTS ix_empresas_categoria_nfe_fornecedores_id ON empresas (categoria_nfe_fornecedores_id)",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def run_legacy_database_bootstrap() -> bool:
    """Cria o banco novo e copia os dados do banco legado quando a flag estiver habilitada."""
    try:
        from app.db.bootstrap import bootstrap_legacy_database, should_auto_bootstrap_legacy_database

        print("Executando bootstrap do banco novo e copia do banco legado...")
        copied_rows = bootstrap_legacy_database()
        print(f"Bootstrap concluido. Registros copiados: {copied_rows}")
        print("Aplicando patch de compatibilidade de schema...")
        apply_legacy_schema_compatibility()
        stats = ensure_rbac_defaults()
        print(
            "RBAC seed concluido. "
            f"Permissoes: {stats.get('permissions_created', 0)}, "
            f"Templates: {stats.get('templates_created', 0)}, "
            f"Perfis admin: {stats.get('company_profiles_created', 0)}, "
            f"Vinculos: {stats.get('user_assignments_created', 0)}"
        )
        print("Banco novo pronto para uso")
        return True
    except Exception as exc:
        print(f"Falha no bootstrap do banco legado: {exc}")
        return False

def run_migrations():
    """Executa Alembic upgrade"""
    try:
        from app.core.config import settings
        from app.db.bootstrap import should_auto_bootstrap_legacy_database

        if settings.COPY_LEGACY_DATABASE or settings.DROP_UNUSED_TABLES or should_auto_bootstrap_legacy_database():
            return run_legacy_database_bootstrap()

        print("Executando migrations do Alembic...")
        
        result = run(
            [sys.executable, "-m", "alembic", "upgrade", "heads"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print("Migrations executadas com sucesso!")
            print(result.stdout)
            print("Aplicando patch de compatibilidade de schema...")
            apply_legacy_schema_compatibility()
            ensure_integracoes_scheduler_schema()
            stats = ensure_rbac_defaults()
            print(
                "RBAC seed concluido. "
                f"Permissoes: {stats.get('permissions_created', 0)}, "
                f"Templates: {stats.get('templates_created', 0)}, "
                f"Perfis admin: {stats.get('company_profiles_created', 0)}, "
                f"Vinculos: {stats.get('user_assignments_created', 0)}"
            )
            return True
        else:
            print("Erro ao executar migrations:")
            print(result.stderr)
            print("Aplicando patch de compatibilidade de schema...")
            apply_legacy_schema_compatibility()
            stats = ensure_rbac_defaults()
            print(
                "RBAC seed concluido. "
                f"Permissoes: {stats.get('permissions_created', 0)}, "
                f"Templates: {stats.get('templates_created', 0)}, "
                f"Perfis admin: {stats.get('company_profiles_created', 0)}, "
                f"Vinculos: {stats.get('user_assignments_created', 0)}"
            )
            print("Patch de compatibilidade aplicado com sucesso!")
            return True
    
    except Exception as e:
        print(f"Erro: {e}")
        return False

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    success = run_migrations()
    sys.exit(0 if success else 1)

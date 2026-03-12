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

# Adicionar raiz ao path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))


def apply_legacy_schema_compatibility() -> None:
    from app.core.config import settings
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
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_como_disponibilidade BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS eh_operacional BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS dre_grupo VARCHAR NOT NULL DEFAULT 'DESPESAS_OPERACIONAIS'",
        "UPDATE entidades SET tipo_pessoa = CASE WHEN upper(coalesce(cpf_cnpj, '')) ~ '^[0-9]{12,}$' THEN 'PJ' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_FISICA', 'PF') THEN 'PF' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_JURIDICA', 'PJ') THEN 'PJ' ELSE coalesce(tipo_pessoa, 'PJ') END WHERE tipo_pessoa IS NULL OR trim(tipo_pessoa) = ''",
        "UPDATE entidades SET tipo = CASE WHEN upper(coalesce(tipo, '')) IN ('CLIENTE', 'FORNECEDOR', 'AMBOS') THEN upper(tipo) ELSE 'AMBOS' END WHERE tipo IS NULL OR upper(coalesce(tipo, '')) NOT IN ('CLIENTE', 'FORNECEDOR', 'AMBOS')",
        "CREATE INDEX IF NOT EXISTS ix_entidades_tipo_pessoa ON entidades (tipo_pessoa)",
        "ALTER TABLE cartoes ADD COLUMN IF NOT EXISTS bandeira VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_cartoes_bandeira ON cartoes (bandeira)",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS oculta BOOLEAN DEFAULT FALSE",
        "UPDATE plano_contas SET oculta = FALSE WHERE oculta IS NULL",
        "CREATE INDEX IF NOT EXISTS ix_plano_contas_oculta ON plano_contas (oculta)",
        "UPDATE plano_contas SET considerar_nos_resultados = TRUE WHERE coalesce(oculta, FALSE) = FALSE",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS transferencia_grupo_id VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_transferencia_grupo_id ON lancamentos (transferencia_grupo_id)",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))

    PlanoContasTemplateConfig.__table__.create(bind=engine, checkfirst=True)

def run_migrations():
    """Executa Alembic upgrade"""
    try:
        print("🔄 Executando migrations do Alembic...")
        
        result = run(
            ["alembic", "upgrade", "head"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print("✅ Migrations executadas com sucesso!")
            print(result.stdout)
            return True
        else:
            print("❌ Erro ao executar migrations:")
            print(result.stderr)
            print("⚠️ Aplicando patch de compatibilidade de schema...")
            apply_legacy_schema_compatibility()
            print("✅ Patch de compatibilidade aplicado com sucesso!")
            return True
    
    except Exception as e:
        print(f"❌ Erro: {e}")
        return False

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    success = run_migrations()
    sys.exit(0 if success else 1)

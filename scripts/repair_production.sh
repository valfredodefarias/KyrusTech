#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   bash scripts/repair_production.sh
#   BACKEND_SERVICE=kyrustech_backend bash scripts/repair_production.sh

BACKEND_SERVICE="${BACKEND_SERVICE:-kyrustech_backend}"

echo "==> Executando reparo de migrations no servico ${BACKEND_SERVICE}"
docker compose exec "${BACKEND_SERVICE}" python scripts/run_migrations.py

echo "==> Validando colunas criticas no banco"
docker compose exec "${BACKEND_SERVICE}" python -c "from sqlalchemy import create_engine, text; from app.core.config import settings; engine=create_engine(settings.DATABASE_URL); required=[('plano_contas','dre_grupo'),('plano_contas','eh_operacional'),('contas','conta_como_disponibilidade')]; missing=[]; 
with engine.connect() as c:
    for t,col in required:
        found=c.execute(text(\"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c)\"), {'t': t, 'c': col}).scalar()
        print(f'{t}.{col}:', 'OK' if found else 'MISSING')
        if not found:
            missing.append(f'{t}.{col}')
if missing:
    raise SystemExit('FALTANDO COLUNAS: ' + ', '.join(missing))
print('VALIDACAO FINAL: OK')"

echo "==> Reparo concluido"

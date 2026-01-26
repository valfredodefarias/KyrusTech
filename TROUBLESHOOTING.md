# 🔧 KYRUS ERP - Guia Avançado de Troubleshooting

## 🐛 Problemas Comuns

### 1. "Connection refused" - Banco não está pronto

**Sintoma**: Erro `psycopg2.OperationalError: could not connect to server`

**Solução**:
```bash
# Verificar se o container de banco está rodando
docker-compose ps db

# Ver logs do banco
docker-compose logs db

# Dar mais tempo para inicializar
sleep 30
docker-compose up -d

# Verificar conexão
docker-compose exec backend python -c "
from app.core.config import settings
from sqlmodel import create_engine
engine = create_engine(str(settings.DATABASE_URL))
with engine.connect() as conn:
    print('✅ Conexão OK')
"
```

### 2. "Permission denied" - Problemas de acesso a arquivos

**Sintoma**: Erro ao acessar `/app/static` ou `/var/lib/postgresql/data`

**Solução**:
```bash
# Dar permissões corretas
sudo chown -R 1000:1000 static/
sudo chown -R 1000:1000 postgres_data/
chmod 755 static
chmod 755 postgres_data

# Ou usar Docker com user correto
docker-compose down -v
docker-compose up -d
```

### 3. "Port already in use" - Porta ocupada

**Sintoma**: `Error: listen EADDRINUSE: address already in use :::8000`

**Solução**:
```bash
# Encontrar processo usando a porta
lsof -i :8000  # Linux/Mac
netstat -ano | findstr :8000  # Windows

# Matar processo
kill -9 <PID>  # Linux/Mac
taskkill /PID <PID> /F  # Windows

# Ou mudar porta no docker-compose.yml
# Alterar "8000:8000" para "8001:8000"
```

### 4. "Frontend em branco" - Página não carrega

**Sintoma**: Página branca no navegador, erro no console

**Solução**:
```bash
# 1. Verificar se frontend foi compilado
ls -la kyrus-web/dist/

# 2. Se não existe, compilar
cd kyrus-web && npm run build && cd ..

# 3. Verificar .env do frontend
cat kyrus-web/.env

# 4. Ver erros do console (F12 no navegador)

# 5. Verificar se URL da API está correta
# Deve ser: http://seu-dominio:8000/api/v1
# NÃO: http://localhost:8000/api/v1 (se acessar de outro IP)

# 6. Testar API diretamente
curl http://seu-ip:8000/api/v1
curl http://seu-ip:8000/health
```

### 5. "CORS error" - Frontend não consegue acessar API

**Sintoma**: `Access to XMLHttpRequest blocked by CORS policy`

**Solução**:
```bash
# 1. Verificar BACKEND_CORS_ORIGINS no .env
cat .env | grep CORS

# 2. Deve incluir http://seu-dominio:3000 (frontend)
# Exemplo:
BACKEND_CORS_ORIGINS=http://localhost:3000,http://meu-site.com

# 3. Reiniciar backend
docker-compose restart backend

# 4. Testar CORS manualmente
curl -i -X OPTIONS http://seu-ip:8000/api/v1 \
  -H "Origin: http://seu-dominio:3000"
```

### 6. "Migrations failed" - Erro ao criar tabelas

**Sintoma**: `sqlalchemy.exc.ProgrammingError: relation "usuario" already exists`

**Solução**:
```bash
# 1. Ver status das migrations
docker-compose exec backend alembic current

# 2. Ver histórico
docker-compose exec backend alembic history

# 3. Reverter última (se necessário)
docker-compose exec backend alembic downgrade -1

# 4. Limpar tudo (CUIDADO - apaga dados!)
docker-compose down -v  # Remove volumes
docker-compose up -d    # Recria tudo

# 5. Se problema persistir, resetar migrations
# (Deleta todas as migrações e cria nova do zero)
rm alembic/versions/*.py
docker-compose exec backend alembic revision --autogenerate -m "Initial"
docker-compose exec backend alembic upgrade head
```

### 7. "Out of memory" - Container morrendo

**Sintoma**: Container sai sozinho, `Killed` nos logs

**Solução**:
```bash
# 1. Ver uso de memória
docker-compose stats

# 2. Aumentar limite de memória no docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G

# 3. Limpar cache e dados desnecessários
docker system prune -a
docker volume prune

# 4. Reiniciar
docker-compose down -v
docker-compose up -d
```

### 8. "Database locked" - Banco travado

**Sintoma**: `database is locked` ou `could not serialize access`

**Solução**:
```bash
# 1. Entrar no banco
docker-compose exec db psql -U kyrus_user -d kyrus_db

# 2. Ver conexões ativas
SELECT * FROM pg_stat_activity;

# 3. Matar conexão problemática (dentro do psql)
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE pid <> pg_backend_pid();

# 4. Sair (Ctrl+D ou \q)

# 5. Reiniciar se problema persistir
docker-compose restart db
```

### 9. "Upload falha" - Erro ao fazer upload de arquivo

**Sintoma**: Erro 500 ao fazer upload

**Solução**:
```bash
# 1. Verificar permissão da pasta
ls -la static/uploads/

# 2. Dar permissão se necessário
sudo chmod 777 static/uploads

# 3. Verificar espaço em disco
df -h

# 4. Verificar tamanho máximo de upload no nginx
# No nginx.conf:
client_max_body_size 100M;

# 5. Ver logs do backend
docker-compose logs backend -f
```

### 10. "High CPU" - CPU em 100%

**Sintoma**: Aplicação lenta, CPU máxima

**Solução**:
```bash
# 1. Ver qual processo está consumindo
docker top kyrus_backend

# 2. Verificar logs
docker-compose logs backend | tail -100

# 3. Ver requisições lentas na API
# Ativar query logging no SQL (development only)

# 4. Otimizar queries
# - Adicionar índices nas tabelas
# - Usar pagination
# - Evitar N+1 queries

# 5. Escalar horizontal
# - Aumentar número de workers
# - Usar load balancer
```

## 🔍 Diagnóstico Rápido

```bash
#!/bin/bash
# Script de diagnóstico

echo "🔍 Diagnóstico do Kyrus ERP"
echo "============================"

echo ""
echo "1️⃣  Docker Status:"
docker-compose ps

echo ""
echo "2️⃣  Recursos:"
docker-compose stats --no-stream

echo ""
echo "3️⃣  Health Check:"
curl -s http://localhost:8000/health | jq .

echo ""
echo "4️⃣  Banco de Dados:"
docker-compose exec -T db psql -U kyrus_user -d kyrus_db -c "SELECT version();"

echo ""
echo "5️⃣  Migrations:"
docker-compose exec -T backend alembic current

echo ""
echo "6️⃣  Logs Recentes:"
docker-compose logs --tail=50

echo ""
echo "✅ Diagnóstico completo"
```

Salve como `scripts/diagnose.sh` e execute com `bash scripts/diagnose.sh`

## 📊 Monitoramento em Tempo Real

```bash
# Terminal 1 - Logs
docker-compose logs -f

# Terminal 2 - Recursos
watch -n 1 'docker-compose stats --no-stream'

# Terminal 3 - Conexões de banco
docker-compose exec db watch -n 2 'psql -U kyrus_user -d kyrus_db -c "SELECT count(*) FROM pg_stat_activity;"'
```

## 🚨 Recuperação de Desastres

### Backup do Banco

```bash
# Criar backup
docker-compose exec -T db pg_dump -U kyrus_user -d kyrus_db > backup.sql

# Restaurar backup
docker-compose exec -T db psql -U kyrus_user -d kyrus_db < backup.sql
```

### Resetar Tudo (Último Recurso)

```bash
# ⚠️ CUIDADO - Apaga TODOS os dados!
docker-compose down -v
rm -rf postgres_data/*
docker-compose up -d
# Aguarde algumas segundos
docker-compose exec backend python scripts/create_admin.py
```

## 📞 Verificações de Produção

Antes de ir para produção, execute:

```bash
# 1. Verificar variáveis de ambiente
cat .env | grep -E "SECRET_KEY|POSTGRES_PASSWORD"

# 2. Verificar se frontend foi compilado
ls -la kyrus-web/dist/ | wc -l

# 3. Testar conexão com banco
docker-compose exec -T backend python -c \
  "from app.db.session import engine; print('✅ DB OK'); engine.dispose()"

# 4. Testar API
curl http://localhost:8000/health

# 5. Teste de carga (opcional)
ab -n 100 -c 10 http://localhost:8000/api/v1

# 6. Verificar espaço em disco
df -h /var/lib/docker

# 7. Verificar backups
ls -la *.sql
```

---

**Ainda com problemas?** 

1. Verifique os logs: `docker-compose logs -f`
2. Consulte DEPLOYMENT.md
3. Reproduza o erro localmente
4. Procure a solução em: https://github.com/tiangolo/fastapi/issues


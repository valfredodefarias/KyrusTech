# 💾 Manual de Backups e Restauração de Dados - KyrusERP

**Documento Operacional de Engenharia**  
**Servidor de Produção**: HostHatch VPS (`103.63.28.155`)  
**Container de Banco**: `db_kyrustech` (PostgreSQL 17)  
**Usuário do Banco**: `kyrus_Ciro` (definido no `.env` como `POSTGRES_USER`)  
**Banco de Dados**: `kyrus_erp`  
**Última Atualização**: Setembro de 2026

---

## 1. Diretriz de Segurança: Protocolo Pré-Deploy

> [!IMPORTANT]
> **Nenhum deploy em produção deve ser executado sem um backup prévio gerado imediatamente antes da atualização.**
> O custo de gerar um dump consistente no PostgreSQL 17 é de aproximadamente 3 a 5 segundos (tamanho típico de 150 MB). O custo de recuperar um banco de dados corrompido sem backup é catastrófico.

### Comando Obrigatório de Backup Pré-Deploy:
Execute conectado via SSH no servidor:
```bash
cd /root/KyrusERP
docker exec db_kyrustech pg_dump -U kyrus_Ciro -Fc -f /tmp/backup_erp.dump kyrus_erp
docker cp db_kyrustech:/tmp/backup_erp.dump ./backup_erp_$(date +%Y%m%d_%H%M%S).dump
ls -lh backup_erp_*.dump | tail -n 2
```

---

## 2. Procedimento de Restauração Completa (Disaster Recovery)

Caso seja necessário restaurar a base de dados a partir de um arquivo `.dump`:

### Passo 1: Parar a Aplicação Backend
Para liberar conexões ativas do pool SQLAlchemy e evitar escritas concorrentes:
```bash
docker stop kyrustech_backend
```

### Passo 2: Encerrar Conexões Residuais no PostgreSQL
```bash
docker exec db_kyrustech psql -U kyrus_Ciro -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'kyrus_erp' AND pid <> pg_backend_pid();"
```

### Passo 3: Recriar a Base Vazia
```bash
# Dropar a base atual
docker exec db_kyrustech dropdb -U kyrus_Ciro kyrus_erp

# Criar a base limpa
docker exec db_kyrustech createdb -U kyrus_Ciro kyrus_erp
```

### Passo 4: Executar a Restauração
```bash
# Copiar o arquivo dump para dentro do container se necessário, ou usar stream direto:
cat ./backup_erp_deploy.dump | docker exec -i db_kyrustech pg_restore -U kyrus_Ciro -d kyrus_erp --no-owner --no-acl --clean --if-exists
```

> [!TIP]
> Os parâmetros `--no-owner` e `--no-acl` garantem que todos os objetos restaurados fiquem automaticamente associados ao usuário do container atual, prevenindo erros de permissão.

### Passo 5: Reiniciar o Backend e Validar
```bash
# Iniciar o backend
docker start kyrustech_backend

# Validar logs de inicialização
docker logs --tail 30 kyrustech_backend

# Conferir contagem de lançamentos
docker exec db_kyrustech psql -U kyrus_Ciro -d kyrus_erp -c "SELECT COUNT(*) FROM lancamentos WHERE is_deleted = false;"

# Healthcheck HTTP
curl -s http://localhost:8000/health
```

---

## 3. Filosofia de Engenharia: Integridade Estrutural dos Dados

- **Sem Hard Deletes Imprudentes**: Lançamentos financeiros em contas conciliadas nunca devem sofrer exclusão física direta sem estorno contábil correspondente.
- **Constraints de Unicidade Parcial**: Todo cadastro relevante possui restrições físicas no banco de dados (`WHERE is_deleted = false`) criadas via Alembic para impedir dados duplicados.
- **Backups Locais e Remotos**: Manter pelo menos os últimos 7 dumps diários no host e sincronizar periodicamente cópias externas criptografadas.

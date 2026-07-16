[🗺️ Visão Geral]([[Visao Geral]]) / [🚀 Fluxo de Desenvolvimento]([[Loops e Validacoes]])
***

# Manual de Restauração de Backup (Dump PostgreSQL) - Kyrus ERP

Este documento descreve o passo a passo detalhado para realizar a restauração de um backup (`.dump`) no banco de dados PostgreSQL do Kyrus ERP, incluindo a resolução de problemas comuns de histórico de migrations (Alembic).

---

## Passo a Passo para Restauração

### 1. Parar o Container do Backend
Para evitar novas conexões ativas que impeçam a remoção (drop) do banco de dados, interrompa o serviço do backend:

```bash
docker stop kyrustech_backend
```

### 2. Copiar o Arquivo de Backup para o Container do Banco
Copie o arquivo de dump da sua máquina local para a pasta `/tmp` do container de banco de dados (`db_kyrustech`):

```bash
docker cp backups/backup_kyrus_perfeito.dump db_kyrustech:/tmp/backup_kyrus_perfeito.dump
```

### 3. Encerrar Conexões Ativas e Dropar/Recriar o Banco
Conecte-se ao banco de dados `postgres` default para forçar o fechamento de conexões pendentes em `kyrus_erp`, e então delete e recrie o banco:

```bash
# Encerrar conexões ativas no banco de dados kyrus_erp
docker exec db_kyrustech psql -U kyrus_user -d postgres -c "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = 'kyrus_erp' AND pid <> pg_backend_pid();"

# Excluir o banco de dados atual
docker exec db_kyrustech dropdb -U kyrus_user kyrus_erp

# Criar um novo banco de dados vazio
docker exec db_kyrustech createdb -U kyrus_user kyrus_erp
```

### 4. Restaurar os Dados do Dump
Execute o `pg_restore` apontando para o arquivo copiado. 

> [!NOTE]
> É normal ocorrerem avisos/erros de `OWNER TO` (ex: `role "kyrus_Ciro" does not exist`), pois o dump foi gerado sob outro usuário. O `pg_restore` ignorará estes erros e restaurará todas as tabelas e dados corretamente sob o usuário `kyrus_user`.

```bash
docker exec db_kyrustech pg_restore -U kyrus_user -d kyrus_erp /tmp/backup_kyrus_perfeito.dump
```

### 5. Limpar Histórico de Migrations Antigas / Desconectadas
Como o backup pode conter registros de migrations que não existem mais localmente (ou que foram consolidadas de outra forma), limpe as referências órfãs na tabela `alembic_version` para evitar o erro `Can't locate revision identified by '...'`:

```bash
docker exec db_kyrustech psql -U kyrus_user -d kyrus_erp -c "DELETE FROM alembic_version WHERE version_num IN ('auditlog_001', 'b6f2a9c7d3e1');"
```

*Verifique se a versão restante na tabela bate com o histórico local (ex: `226b4c1e34d9`).*

### 6. Reiniciar o Container do Backend e Executar Migrations
Com o banco restaurado e a tabela de histórico de migrations limpa, inicie o container do backend. O container executará automaticamente o script `run_migrations.py` na inicialização, aplicando as migrations restantes até a versão mais recente (`heads`):

```bash
docker start kyrustech_backend
```

Se preferir rodar manualmente as migrations subsequentes:
```bash
docker exec kyrustech_backend alembic upgrade heads
```

### 7. Validar a Integridade com Testes
Execute a suíte de testes locais para garantir que a compatibilidade do banco e aplicação está 100% íntegra:

```powershell
.\.venv\Scripts\python -m pytest tests
```

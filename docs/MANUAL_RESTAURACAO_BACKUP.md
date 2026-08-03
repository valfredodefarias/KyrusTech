# Manual de Restauração de Backup (Dump PostgreSQL) - Kyrus ERP

**Documento Operacional de Engenharia**  
**Padrão Nível Google / Enterprise**  
**Última Atualização**: 28 de Julho de 2026  

---

## 1. Visão Geral do Processo de Restauração

> [!NOTE]
> Para o procedimento de **geração de dumps em ambiente de produção** lendo credenciais do `.env` e prevenindo corrupção de logs, consulte o [MANUAL_DUMP_PRODUCAO.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/MANUAL_DUMP_PRODUCAO.md).

Este guia descreve os procedimentos de nível de engenharia para realizar a restauração completa de um dump PostgreSQL (`.dump` custom format ou SQL plain) no banco de dados containerizado `db_kyrustech`.

### Datasets Garantidos no Backup Restaurado:
- **399.602 Lançamentos Financeiros**
- **23 Empresas cadastradas**
- **12.686 Entidades (Clientes / Fornecedores)**
- **94 Contas Bancárias / Caixas**
- **56 Regras de Cartão de Crédito/Débito**
- **65 Usuários e Perfis RBAC**

---

## 2. Passo a Passo de Restauração Rápida (Binary Stream Technique)

### Passo 1: Parar a Aplicação Backend
Para liberar travas de tabela e conexões ativas do SQLAlchemy:
```bash
docker stop kyrustech_backend
```

### Passo 2: Encerrar Conexões Pendentes e Recriar o Banco Vazio
```bash
# Encerrar conexões ativas na base kyrus_erp
docker exec db_kyrustech psql -U kyrus_user -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'kyrus_erp' AND pid <> pg_backend_pid();"

# Dropar o banco atual
docker exec db_kyrustech dropdb -U kyrus_user kyrus_erp

# Criar um novo banco de dados limpo
docker exec db_kyrustech createdb -U kyrus_user kyrus_erp
```

### Passo 3: Restauração Ultra-Rápida via Binary Stream (Sub-10 Segundos)
No Windows PowerShell / CMD, utilize o `cmd.exe /c` para transmitir o arquivo `.dump` via STDERR/STDOUT sem consumo excessivo de memória RAM no host:

```cmd
cmd.exe /c "docker exec -i db_kyrustech pg_restore -U kyrus_user -d kyrus_erp --no-owner --no-acl < backups\dump.dump"
```

> [!NOTE]
> É esperado receber alertas de `OWNER TO` ou papéis como `kyrus_Ciro` que pertenciam ao servidor de origem. As opções `--no-owner` e `--no-acl` instruem o `pg_restore` a vincular todas as tabelas e dados diretamente ao usuário `kyrus_user`.

---

## 3. Patch de Compatibilidade de Schema SQL (Pós-Restauração)

Dumps legados podem requerer a presença de novas colunas exigidas pelo modelo de dados atual do ERP. Execute o comando SQL abaixo para garantir idempotência:

```bash
docker exec db_kyrustech psql -U kyrus_user -d kyrus_erp -c "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS data_bloqueio_periodo DATE;"
```

> [!TIP]
> Essa verificação também foi incorporada diretamente no script [scripts/run_migrations.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/scripts/run_migrations.py#L83), sendo executada automaticamente na inicialização do backend.

---

## 4. Limpeza de Histórico de Migrations (Alembic)

Caso o dump possua registros de revisões de migração órfãs que não existam mais no repositório:

```bash
docker exec db_kyrustech psql -U kyrus_user -d kyrus_erp -c "DELETE FROM alembic_version WHERE version_num IN ('auditlog_001', 'b6f2a9c7d3e1');"
```

---

## 5. Reinicialização e Validação do Sistema

### Subir o Backend
```bash
docker start kyrustech_backend
```

### Validar Contagem de Registros Restaurados
```bash
docker exec db_kyrustech psql -U kyrus_user -d kyrus_erp -c "SELECT COUNT(*) FROM lancamentos;"
```
*(Deve retornar **399.602** registros).*

### Executar Testes Automatizados de Validação
```powershell
.\.venv\Scripts\pytest.exe tests/ -k "pdv or recebiveis or lancamento"
```
*(Deve retornar **100% Passed**).*

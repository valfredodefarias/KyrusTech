[🗺️ Visão Geral]([[Visao Geral]]) / [🚀 Fluxo de Desenvolvimento]([[Loops e Validacoes]])
***

# Plano de Otimização e Escalabilidade de Performance - Kyrus ERP

Este documento detalha o conjunto de melhorias de arquitetura, código e infraestrutura projetadas para sanar os gargalos de concorrência e banco de dados detectados nos testes de estresse, permitindo ao Kyrus ERP suportar centenas de acessos simultâneos sem travamentos ou timeouts.

---

## 📋 Resumo Executivo dos Gargalos Diagnosticados
1. **Event Loop Blocking**: O FastAPI utiliza sessões síncronas com o banco de dados. Como o Uvicorn roda com apenas 1 worker no ambiente de desenvolvimento, qualquer consulta pesada (ex: DRE) bloqueia completamente a única thread de eventos do servidor.
2. **Escrita a Cada Clique**: Em toda requisição autenticada, o sistema realiza um `UPDATE` no Postgres para registrar o horário da última atividade (`last_activity_at`). Isso satura os canais de escrita física em disco em cenários concorrentes.
3. **Buscas Sequenciais de Texto**: A query de DRE usa filtros negativos (`NOT ILIKE '%...%'`), o que impede o uso de índices comuns e força varreduras completas da tabela (*Sequential Scans*).
4. **Desalinhamento de Limites**: O pool de conexões do cliente (FastAPI) estava mal dimensionado perante as conexões simultâneas do Postgres, causando recusa de requisições.

---

## 🛠️ Plano de Ação das Otimizações

### ⚡ 1. Otimização de Banco de Dados: Índice Composto Parcial para Lançamentos (DRE)

Criaremos um **Índice Parcial** que pré-filtra os registros de negação diretamente na estrutura física de dados do Postgres.

*   **Arquivo a Modificar**: `app/main.py`
*   **Ação**: Adicionar ao patch de inicialização automática:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_lancamentos_dre_perf ON lancamentos (empresa_id, data_competencia, data_vencimento) WHERE is_deleted = false AND (observacao IS NULL OR (observacao NOT ILIKE '%DestinoCompra DEMONSTRACAO%' AND observacao NOT ILIKE '%"legacy_id_venda"%'))
    ```

---

### ⚙️ 2. Configurabilidade DevOps (.env) para Pool de Banco de Dados

Expor os parâmetros do pool do banco de dados no arquivo `.env` para permitir ajustes ágeis na infraestrutura.

*   **Arquivos a Modificar**: `app/core/config.py`, `app/db/session.py`, `.env.example`, `.env`
*   **Novas Variáveis**:
    ```ini
    DATABASE_POOL_SIZE=25
    DATABASE_MAX_OVERFLOW=35
    DATABASE_POOL_TIMEOUT=10
    REDIS_URL=redis://redis:6379/0
    ```
*   **Definição no SQLAlchemy (`session.py`)**:
    ```python
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=settings.DATABASE_POOL_SIZE,
        max_overflow=settings.DATABASE_MAX_OVERFLOW,
        pool_timeout=settings.DATABASE_POOL_TIMEOUT,
        pool_recycle=3600
    )
    ```
*   **Postgres Session Timeouts**:
    Adicionar um event listener de conexão no SQLAlchemy para forçar limites de travamento de forma defensiva:
    ```python
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def set_pg_timeouts(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("SET lock_timeout = '5000';")      # Timeout de 5s para travas
        cursor.execute("SET statement_timeout = '8000';") # Timeout de 8s para queries
        cursor.close()
    ```

---

### 🛢️ 3. Otimização do PostgreSQL (Asynchronous Commits & max_connections)

*   **Arquivos a Modificar**: `docker-compose.yml`, `docker-compose.prod.yml`
*   **Alterações**:
    1.  Ampliar o limite do Postgres para **300 conexões** simultâneas (o padrão é 100).
    2.  Ativar escrita de commits assíncronos (`synchronous_commit=off`), **multiplicando por até 10x** a taxa de escrita simultânea em banco de dados.
    3.  Registrar queries que levem mais de 1 segundo (`log_min_duration_statement=1000`).
*   **Configuração nos Containers**:
    ```yaml
    # docker-compose.yml
    command: ["postgres", "-c", "shared_buffers=512MB", "-c", "work_mem=64MB", "-c", "maintenance_work_mem=128MB", "-c", "effective_cache_size=1.5GB", "-c", "max_connections=300", "-c", "log_min_duration_statement=1000", "-c", "synchronous_commit=off"]
    ```

---

### 🚀 4. Paralelismo de Processos, Redis Cache e Pooling do Nginx

*   **Workers Backend**: Rodar o Uvicorn com **4 workers** em paralelo e backlog TCP estendido para **8192** (em `docker-compose.yml`).
*   **Nginx Keep-Alive**: Configurar o Nginx (`nginx.conf` e `nginx-ssl.conf`) para manter conexões abertas (`keepalive 32;` / `proxy_set_header Connection "";`) com a API, evitando handshakes repetidos de rede.
*   **Serviço Redis**: Incluir o container Redis no compose para gerenciar cache compartilhado (horizontalmente escalável).
*   **Fallback no Código**: Ajustar o `app/core/cache.py` para usar Redis se `REDIS_URL` estiver configurado, caso contrário manter o fallback transparente na memória RAM local.

---

### ⚙️ 5. GC Tuning e Pre-aquecimento de Pool no Lifespan

*   **Arquivo a Modificar**: `app/main.py`
*   **Ação**: Ajustar a inicialização do lifespan do FastAPI para:
    1.  Tunar thresholds do Garbage Collector (`gc.set_threshold(50000, 10, 10)`).
    2.  Abrir previamente todas as 25 conexões do pool de banco de dados para evitar latência no primeiro acesso dos usuários.

---

### 🛡️ 6. Throttling de Gravação de Sessão (Deps de Autenticação)

*   **Arquivo a Modificar**: `app/api/deps.py`
*   **Ação**: Atualizar a data da última atividade no banco apenas se o intervalo for maior do que 60 segundos, poupando 99% das escritas.
    ```python
    from datetime import datetime
    now = datetime.utcnow()
    if not sess.last_activity_at or (now - sess.last_activity_at).total_seconds() > 60:
        sess.last_activity_at = now
        session.add(sess)
        session.commit()
    ```

---

### 💾 7. Cache com Lock Distribuído no Redis (Distributed Double-Checked Locking)

*   **Arquivo a Modificar**: `app/api/v1/endpoints/dre.py`
*   **Ação**: Implementar o padrão Double-Checked Locking no Redis (`redis_client.lock`) ao calcular o DRE, assegurando que apenas **1 worker no cluster inteiro** execute a query pesada no banco ao expirar o cache, enquanto os outros aguardam e leem o dado pronto.

---

## 📈 Plano de Verificação Pós-Execução

Após implementar as modificações acima, execute o teste de estresse contido no container do backend:
```bash
docker exec -t kyrustech_backend python scripts/benchmark_stress.py --duration 10 --steps "10,25,50,100"
```
A meta é que o sistema suporte concorrência de até **100 usuários simultâneos com zero erros de timeout**, apresentando um ganho de vazão (RPS) de no mínimo 30x a 50x em relação ao limite anterior (que colapsou com 5 usuários).

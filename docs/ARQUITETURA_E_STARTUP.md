# Arquitetura de Inicialização, Containers e Infraestrutura (Kyrus ERP)

**Documento de Especificação Técnica de Engenharia**  
**Padrão Nível Google / Enterprise**  
**Última Atualização**: 26 de Setembro de 2026  

---

## 1. Visão Geral da Arquitetura de Containers

O **Kyrus ERP** utiliza uma topologia de microsserviços containerizados orchestrados via Docker Compose, com separação de redes para tráfego web/API e persistência interna:

```mermaid
graph TD
    User([Navegador / Cliente]) -->|Porta 3000| Nginx[Frontend: Node 20 / Nginx Alpine]
    Nginx -->|Porta 8000| Backend[Backend FastAPI: 4 Workers Uvicorn]
    Backend -->|Rede Interna: 5432| Postgres[(PostgreSQL 17 Alpine: db_kyrustech)]
    Backend -->|Rede Interna: 6379| Redis[(Redis 7 Alpine: redis_kyrustech)]
    
    subgraph "Rede kyrus_portal (Externa / Proxy)"
        Nginx
        Backend
    end

    subgraph "Rede kyrus_db_internal (Persistência & Cache)"
        Postgres
        Redis
    end
```

### Componentes de Infraestrutura

| Container | Imagem Base | Portas | Função / Responsabilidade |
| :--- | :--- | :--- | :--- |
| `kyrustech_frontend` | `node:20-alpine` (dev) / `nginx:alpine` (prod) | `3000` | Interface SPA React 18, Vite, TypeScript, Tailwind |
| `kyrustech_backend` | `python:3.11-slim` | `8000` | API REST assíncrona FastAPI, SQLModel, SQLAlchemy 2 |
| `db_kyrustech` | `postgres:17-alpine` | `5432` | Banco relacional corporativo (399k+ registros, WAL ACID) |
| `redis_kyrustech` | `redis:7-alpine` | `6379` | Cache de alta velocidade, Pub/Sub para WebSockets e filas |

---

## 2. Fluxo de Boot & Inicialização do Backend (`scripts/run_migrations.py`)

Ao iniciar ou reiniciar os containers Docker, o serviço `kyrustech_backend` executa a seguinte sequência síncrona e otimizada de boot:

```mermaid
graph TD
    A[Container Boot: uvicorn] --> B[python scripts/run_migrations.py]
    B --> C[1. Alembic Upgrade Heads - 48 Modelos Mapeados]
    C --> D[2. Schema Compatibility Patch SQL]
    D --> E[3. Seed de Permissões & Perfis RBAC]
    E --> F[4. Pre-warming do Connection Pool - 25 Conexões]
    F --> G[5. Inicialização de Schedulers Assíncronos]
    G --> H[6. Server Ready na Porta 8000]
```

### Otimizações do Boot (Redução de 12.5s para 1.5s)
1. **Desativação de Connectivity Probes Legadas**: Desativadas as verificações automáticas TCP contra instâncias legadas de PostgreSQL (`postgresql:5432`).
2. **Registro Integral de Modelos no Alembic**: O arquivo `alembic/env.py` importa o módulo unificado `app.models`, garantindo que todas as 48 entidades SQLModel estejam refletidas em `target_metadata = SQLModel.metadata`.
3. **Schema Compatibility Patch**: O script `scripts/run_migrations.py` aplica garantias idempotentes de schema antes de subir a API, como:
   ```sql
   ALTER TABLE empresas ADD COLUMN IF NOT EXISTS data_bloqueio_periodo DATE;
   ```
4. **Pre-warming de Conexões**: O lifespan do FastAPI inicializa um pool pré-aquecido de conexões assíncronas com o PostgreSQL, eliminando a latência da primeira requisição do usuário (respostas em **sub-15ms**).
5. **Background Schedulers no Lifespan**: Execução em background de `integracao_scheduler.py` (sincronização de cartões/bancos) e `demo_cleanup_service.py` (purga periódica de tenants efêmeros de demonstração).

---

## 3. Arquitetura de Build & Docker Context Optimization

### A. Redução Rígida de Build Context (`.dockerignore`)
- **Problema Solucionado**: Arquivos de dump de banco de dados (`*.dump`, `*.sql`, `backup*` somando 1.8 GB) e artefatos de desenvolvimento eram transferidos para o daemon Docker a cada compilação.
- **Engenharia de Solução**: Filtro no `.dockerignore` ignorando dumps, planilhas e a subpasta `kyrus-web/` do contexto do backend.
- **Métrica**: O contexto enviado ao Docker Daemon caiu de **455 MB+ (até 1.8 GB) para 41.1 MB** (redução de 90.9%).

### B. Frontend High-Performance Multi-Stage (`kyrus-web`)
- **Build Stage**: Compilação de código TypeScript/React via Node.js 20 Alpine (`npm run build`).
- **Production Stage**: Servido por **Nginx Alpine (`nginx:alpine`)** sob container dedicado.
- **Configuração Nginx (`kyrus-web/nginx.conf`)**:
  - **SPA Fallback**: `try_files $uri $uri/ /index.html;` (suporte a refresh F5 no React Router).
  - **Gzip Compression Level 6**: Reduz transferência de JS/CSS de 2.4 MB para **~720 KB** (-70%).
  - **OWASP Security Headers**:
    ```nginx
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    ```
  - **Cache Estático**: 1 ano de cache inalterável (`Cache-Control "public, no-transform, immutable"`) em `/assets/`.

---

## 4. Tuning de Banco de Dados PostgreSQL 17 (I/O SSD / NVMe & Durabilidade ACID)

No `docker-compose.yml` e `docker-compose.prod.yml`, o container `db_kyrustech` possui parâmetros avançados de I/O e durabilidade:

```yaml
command: >
  postgres
  -c shared_buffers=512MB
  -c work_mem=64MB
  -c maintenance_work_mem=128MB
  -c effective_cache_size=1.5GB
  -c synchronous_commit=on
  -c checkpoint_completion_target=0.9
  -c random_page_cost=1.1
  -c max_connections=300
```

- **`synchronous_commit=on`**: Garante durabilidade estrita ACID. O commit só é retornado ao cliente após a escrita física dos dados no Write-Ahead Log (WAL) no disco, eliminando qualquer risco de perda de transações contábeis ou financeiras em caso de falha de energia ou reinicialização abrupta do host.
- **`checkpoint_completion_target=0.9`**: Distribui a gravação dos dados no SSD durante 90% do intervalo de checkpoint, evitando picos de I/O na gravação.
- **`random_page_cost=1.1`**: Instrui o planejador de queries do PostgreSQL a utilizar leituras randômicas por índice, otimizando buscas em SSD/NVMe.
- **`shared_buffers=512MB`**: Cache dedicado em memória para leitura ultrarrápida de tabelas quentes (contas a pagar, receber, conciliação e cartões).

---

## 5. Mapeamento de Redes no Docker Compose

Para garantir compatibilidade tanto em ambiente de desenvolvimento local quanto no servidor de produção (`ServidorLinkConsultoria` / HostHatch):

```yaml
networks:
  kyrus_portal:
    external: true
  kyrus_db_internal:
    internal: false
```

- **`kyrus_portal`**: Rede externa que comunica o Nginx reverso e o backend FastAPI.
- **`kyrus_db_internal`**: Rede dedicada de comunicação entre Backend, PostgreSQL e Redis.

---

## 6. Procedimentos de Deploy e Operação

### Atualização Padrão em Produção (Sub-2 Segundos)
```bash
git pull origin main
docker compose restart backend
```

### Reconstrução de Containers (com Cache de Camadas)
```bash
docker compose up -d --build
```

### Execução Manual de Migrations
```bash
docker compose exec backend alembic upgrade head
```

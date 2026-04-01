# Infraestrutura do Kyrus ERP

Versão rápida para operação diária: [INFRAESTRUTURA_EXECUTIVA.md](INFRAESTRUTURA_EXECUTIVA.md)

## 0. Processo obrigatório para novas features (anti-erro)

Este bloco deve ser seguido sempre que uma nova feature tocar backend, banco, autenticação, integrações, deploy ou observabilidade. A regra é: nenhuma feature vai para produção sem passar por integridade, erros, segurança, logs e validação final de cenários.

### 0.1 Pré-desenvolvimento (antes de codar)

Checklist obrigatório:

1. Definir impacto da feature:
  - API nova?
  - Mudança de schema?
  - Novo secret/variável de ambiente?
  - Mudança de comportamento de autenticação/autorização?
2. Definir rollback:
  - Como desfazer a mudança sem perda de dados?
  - Migration reversível (downgrade) quando aplicável?
3. Definir critérios de aceite:
  - O que precisa funcionar para considerar ok?
  - Quais cenários de erro devem retornar resposta controlada?

### 0.2 Integridade de dados (durante o desenvolvimento)

Regras:

1. Toda alteração de banco deve passar por migration.
2. Não aplicar SQL manual em produção fora de casos emergenciais documentados.
3. Validar constraints:
  - chaves estrangeiras
  - unicidade
  - not null
  - defaults
4. Garantir idempotência em rotinas de importação e jobs.
5. Não usar host/IP hardcoded para banco em scripts ou código.

### 0.3 Tratamento de erros

Regras:

1. Nunca vazar stack trace sensível para cliente.
2. Toda exceção previsível deve virar erro de negócio claro (4xx) ou erro interno controlado (5xx).
3. Erros devem carregar contexto mínimo para diagnóstico:
  - endpoint
  - entidade/ID (quando aplicável)
  - operação tentada

### 0.4 Segurança

Checklist:

1. Confirmar autenticação e autorização por rota alterada.
2. Revisar CORS em produção (sem wildcard aberto indevido).
3. Garantir SECRET_KEY forte e fora de código versionado.
4. Não registrar senha, token, credencial ou dados sensíveis em logs.
5. Validar que conexões de banco seguem rede interna Docker (kyrus_portal).

### 0.5 Logs e rastreabilidade

Checklist:

1. Logs úteis em pontos críticos:
  - início/fim de operações longas
  - decisões de conciliação/importação
  - falhas de integração
2. Não gerar log excessivo de sucesso em loops grandes sem necessidade.
3. Garantir logs de validação de startup:
  - migração aplicada
  - app de pé
  - dependências críticas acessíveis

### 0.6 Conferência final obrigatória (antes de liberar)

Executar e registrar:

1. Integridade:
  - migrations sobem sem erro
  - dados essenciais preservados
2. Erros:
  - cenários negativos retornam resposta correta
3. Segurança:
  - sem segredo em logs
  - CORS e auth corretos
4. Logs:
  - mensagens suficientes para investigar incidentes
5. Validação multi-cenário (matriz no item 12 deste documento)

Somente após todos os itens ok a feature pode ser considerada pronta para produção.

## 1. Visão geral

O Kyrus ERP é composto por:

- Backend: FastAPI + SQLModel + Alembic
- Frontend: React + Vite
- Banco principal: PostgreSQL em container standalone externo chamado postgresql
- Orquestração: Docker Compose (múltiplos arquivos por cenário)

Objetivo de segurança vigente:

- Porta externa 5432 fechada
- Conexão ao banco apenas por rede interna Docker
- Host do banco no app: postgresql

## 2. Componentes e responsabilidades

### Backend

- Serviço HTTP principal da API
- Rotas em /api/v1
- Migrações em startup com scripts/run_migrations.py
- Serviço de arquivos estáticos em /static
- Fallback para SPA buildada

Arquivos principais:

- app/main.py
- app/core/config.py
- app/db/session.py
- Dockerfile

### Frontend

- React + Vite
- Em cenário base roda em container de frontend
- Em produção é servido por Nginx (prod/ssl)

Diretriz obrigatória de interface:

- [FRONTEND_UI_GUIDELINES.md](FRONTEND_UI_GUIDELINES.md) - regras para telas leves, amigáveis e com boa experiência de uso.

Arquivos principais:

- kyrus-web/Dockerfile
- kyrus-web/src

### Banco PostgreSQL (externo ao compose)

- Container standalone: postgresql
- Não é provisionado pelos compose do repositório
- Tráfego via rede externa kyrus_portal

## 3. Topologia de rede Docker

### Rede externa obrigatória

- Nome: kyrus_portal
- Tipo: bridge externa
- Pré-requisito para comunicação backend/app com banco

Criação (uma vez):

```bash
docker network create kyrus_portal
```

### Conectividade esperada

1. Serviço backend/app conectado em kyrus_portal
2. Container postgresql conectado em kyrus_portal
3. DNS interno resolvendo postgresql
4. Porta interna 5432 alcançável somente dentro da rede

## 4. Arquivos de compose e cenários

### docker-compose.yml

Cenário padrão:

- backend
- frontend

Pontos principais:

- Backend em BACKEND_PORT (default 8000)
- Frontend em FRONTEND_PORT (default 3000)
- Backend em redes:
  - kyrus_portal (banco)
  - default (comunicação local)

### docker-compose.prod.yml

Cenário produção com profile prod:

- backend com múltiplos workers
- nginx para entrega web

Pontos principais:

- Backend em redes:
  - kyrus_portal
  - kyrustech_network
- Nginx em kyrustech_network
- Exposição pública: 80 e 443

Subida:

```bash
docker compose --profile prod -f docker-compose.prod.yml up -d
```

### docker-compose.ssl.yml

Cenário SSL com Nginx:

- backend
- nginx
- volume certbot_www
- bloco de certbot opcional comentado

Pontos principais:

- Backend em redes:
  - kyrus_portal
  - kyrustech_network
- Nginx em kyrustech_network

Subida:

```bash
docker compose -f docker-compose.ssl.yml up -d
```

### docker-compose.casaos.yml

Cenário CasaOS:

- app (imagem GHCR única)
- watchtower

Pontos principais:

- app em redes:
  - kyrus_portal
  - default
- Watchtower ativa atualização por label

Subida:

```bash
docker compose -f docker-compose.casaos.yml up -d
```

## 5. Variáveis de ambiente críticas

Arquivos:

- .env (real)
- .env.example (modelo)

Núcleo mínimo:

```env
ENVIRONMENT=production
SECRET_KEY=<chave-forte-com-32+-caracteres>
BACKEND_CORS_ORIGINS=<origens-validas>

POSTGRES_SERVER=postgresql
POSTGRES_PORT=5432
POSTGRES_USER=<usuario>
POSTGRES_PASSWORD=<senha>
POSTGRES_DB=<database>
POSTGRES_ALLOWED_CIDRS=<cidrs-autorizados>
```

No stack atual, o PostgreSQL próprio sobe como `db_kyrustech` e a porta pública padrão é `5444`.

Regras:

1. Não usar IP público, localhost ou 127.0.0.1 para o banco em produção.
2. POSTGRES_SERVER deve ser postgresql.
3. Não versionar .env real.
4. Não registrar credenciais em logs.

## 6. Fluxo de inicialização do backend

1. Carrega .env via configuração central.
2. Monta DATABASE_URL com postgresql+psycopg2.
3. Em compose padrão, scripts/run_migrations.py roda antes do Uvicorn.
4. AUTO_RUN_MIGRATIONS deve ficar desabilitado (0) quando a migration já roda no comando do container, evitando execução duplicada.
5. Em caso de falha de migration, aplica patch de compatibilidade legado (conforme app/main.py).
6. Inicia Uvicorn e expõe /health e /api/v1.

## 7. Banco de dados e migrações

Práticas obrigatórias:

1. Toda mudança de schema em migration versionada.
2. Nunca depender de script local avulso com SQL manual para fluxo normal.
3. Validar upgrade e downgrade em ambiente de teste.
4. Antes de release grande, fazer backup consistente.

Comandos úteis:

```bash
python scripts/run_migrations.py
```

## 8. Segurança operacional

Controles atuais:

1. Banco sem porta pública 5432.
2. App se comunica com banco só por rede Docker interna.
3. Validações de SECRET_KEY e CORS em produção.
4. Upload com validação de extensão, MIME, assinatura binária (magic bytes), tamanho e arquivo vazio.
5. Exclusão de anexo com validação de caminho local seguro (sem path traversal).
6. Frontend aceita URL de asset apenas de host confiável (mesma origem/API) e caminho /static.
7. Acesso administrativo ao banco deve usar `POSTGRES_ALLOWED_CIDRS` + regras geradas por `scripts/generate_postgres_hba.py`.

Quando for liberar DBeaver, inclua a subnet do Docker do app e apenas os IPs/CIDRs que realmente precisam de acesso direto ao PostgreSQL.

Controles obrigatórios contínuos:

1. Rotação de senha de banco e chaves sensíveis.
2. Revisão de permissões por endpoint novo.
3. Verificação de exposição indevida de portas.
4. Revisão de logs para evitar vazamento de dados sensíveis.

## 9. Logs, monitoramento e diagnóstico

Fontes principais:

1. Logs do backend FastAPI/Uvicorn.
2. Logs de Nginx (prod/ssl).
3. Logs de eventos de importação e conciliação.

Comandos úteis:

```bash
docker compose -f docker-compose.yml logs -f backend
docker compose --profile prod -f docker-compose.prod.yml logs -f backend nginx
docker compose -f docker-compose.ssl.yml logs -f backend nginx
docker compose -f docker-compose.casaos.yml logs -f app
```

Padrão mínimo de observabilidade por feature nova:

1. Log de início/fim de operação crítica.
2. Log de erro com contexto suficiente para investigação.
3. Sem payload sensível em texto aberto.

### 9.1 Regras específicas de logs para upload e anexos

1. Nunca registrar conteúdo do arquivo em log.
2. Nunca registrar token, cookie, secret, senha ou chave de API.
3. Em erro de upload, logar apenas:
  - endpoint
  - usuário/empresa (IDs)
  - nome sanitizado do arquivo
  - motivo técnico (tipo inválido, assinatura inválida, tamanho excedido, arquivo vazio)
4. Em sucesso de upload, evitar log verboso por arquivo em loop grande.

## 10. Health check e verificação rápida de infraestrutura

### 10.1 Validar sintaxe de compose

```bash
docker compose -f docker-compose.yml config
docker compose --profile prod -f docker-compose.prod.yml config
docker compose -f docker-compose.ssl.yml config
docker compose -f docker-compose.casaos.yml config
```

### 10.2 Validar rede externa

```bash
docker network inspect kyrus_portal
```

### 10.3 Validar containers e redes

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Networks}}"
```

### 10.4 Validar resolução/acesso ao banco a partir do backend

```bash
docker exec -it kyrustech_backend sh -lc "getent hosts postgresql && nc -zv postgresql 5432"
```

### 10.5 Validar API

```bash
curl http://localhost:8000/health
```

## 11. Processo de conferência final de release

Antes de considerar ok:

1. Integridade:
  - migrations aplicadas
  - sem regressão de dados críticos
2. Erros:
  - fluxos inválidos retornando status correto
  - sem crash em cenários previsíveis
3. Segurança:
  - autenticação/autorização revisadas
  - sem credencial exposta
4. Logs:
  - rastreabilidade de erro e operação
5. Infra:
  - compose e rede validados
  - health endpoint respondendo

## 12. Matriz de validação (vários casos)

Executar no mínimo os casos abaixo por feature com impacto infra/backend:

1. Cenário feliz da feature.
2. Payload inválido (campos ausentes/tipo errado).
3. Usuário sem permissão (esperado 401/403).
4. Dependência externa indisponível (erro controlado).
5. Banco temporariamente indisponível (erro 5xx controlado e log útil).
6. Reprocessamento/idempotência (não duplicar dados).
7. Migração aplicada em base com dados existentes.
8. Startup com migration já aplicada (não quebrar).
9. Verificação de logs sem dados sensíveis.
10. Smoke final:
   - /health
   - endpoint principal da feature
   - fluxo de leitura e escrita

## 13. Padrão de manutenção deste documento

Sempre que houver mudança de infraestrutura:

1. Atualizar este arquivo no mesmo PR.
2. Atualizar variáveis e exemplos (quando necessário).
3. Rodar validações do item 10.
4. Aplicar conferência final dos itens 11 e 12.
5. Só então marcar release como ok.

## 14. Rastreabilidade de segurança e logs (onde foi mexido)

Este bloco registra pontos alterados para reforço de segurança/observabilidade e deve ser atualizado em mudanças futuras.

### 14.1 Backend e infraestrutura

1. Central de validação de upload:
  - app/core/upload_security.py
2. Upload genérico autenticado (imagens):
  - app/api/v1/endpoints/anexos.py
3. Upload e deleção segura de anexos de lançamentos:
  - app/api/v1/endpoints/lancamentos.py
4. Upload de foto/logo com validação unificada:
  - app/api/v1/endpoints/usuarios.py
  - app/api/v1/endpoints/contas.py
  - app/api/v1/endpoints/empresas.py
5. Prefixo de API por configuração + fallback SPA com caminho absoluto:
  - app/main.py
6. Normalização de validação de segurança sem duplicidade:
  - app/core/config.py
7. Hardening de compose (CORS sem wildcard no fallback + AUTO_RUN_MIGRATIONS):
  - docker-compose.yml
  - docker-compose.prod.yml
  - docker-compose.ssl.yml
  - docker-compose.casaos.yml
8. Runtime padrão de container backend:
  - Dockerfile
9. Modelo de ambiente com CORS explícito:
  - .env.example

### 14.2 Frontend (validação de links de assets/anexos)

1. Resolução segura de URL pública de assets (somente host confiável + /static):
  - kyrus-web/src/services/api.ts
2. Sanitização de URL de anexo no formulário de lançamentos:
  - kyrus-web/src/pages/Lancamentos.tsx

### 14.3 Checklist obrigatório pós-alteração (segurança/logs)

1. Rodar docker compose config em todos os compose suportados.
2. Validar upload de arquivo permitido e rejeição dos proibidos.
3. Validar rejeição de assinatura incompatível (ex.: extensão PDF com conteúdo não-PDF).
4. Validar rejeição de arquivo vazio e de tamanho acima do limite.
5. Validar deleção de anexo sem permitir path traversal.
6. Validar que links externos fora do domínio confiável não são utilizados no frontend.
7. Revisar logs para confirmar ausência de credenciais e payload sensível.

## 15. Playbook de incidentes (upload/anexos/segurança)

Este procedimento deve ser seguido quando houver suspeita de arquivo malicioso, tentativa de bypass de validação ou uso de link externo indevido.

### 15.1 Gatilhos de incidente

Abrir incidente imediatamente se houver:

1. Rejeições repetidas por assinatura inválida (magic bytes) para mesma origem.
2. Múltiplas tentativas com extensões proibidas em curto intervalo.
3. Tentativa de path traversal em URL/caminho de anexo.
4. Referência a URL externa não confiável para assets/anexos.
5. Erros anormais de upload com crescimento súbito de volume.

### 15.1.1 Telemetria automática implementada

Hoje o backend já dispara alerta técnico automático para os gatilhos abaixo:

1. Rejeições repetidas por origem/endpoint (janela de 5 minutos).
2. Volume anômalo de uploads por origem/endpoint (janela de 1 minuto).
3. Tentativa de path traversal em deleção de anexo.

Implementação:

1. app/core/upload_security.py
2. app/api/v1/endpoints/anexos.py
3. app/api/v1/endpoints/lancamentos.py

Parâmetros atuais (ajustáveis):

1. Rejeições repetidas: 5 eventos em 300s.
2. Volume anômalo: 30 uploads em 60s.

Observação de desempenho:

1. Contadores são em memória com estruturas O(1) (dict + deque) e limpeza por janela deslizante.
2. Não há consulta adicional em banco para acionar gatilho.

### 15.2 Contenção imediata (0-15 minutos)

1. Identificar empresa, usuário e endpoint afetado.
2. Bloquear sessão/token do usuário suspeito (se aplicável).
3. Revisar logs recentes de backend e proxy para o período.
4. Isolar anexos suspeitos sem apagar evidência:
  - mover para área de quarentena interna
  - manter hash e timestamp para auditoria
5. Confirmar que serviço continua saudável:
  - health check
  - rota principal de upload

### 15.3 Erradicação e recuperação (15-60 minutos)

1. Confirmar causa raiz:
  - payload inválido
  - tipo/extensão incompatível
  - URL externa fora de política
2. Aplicar correção de regra (backend/frontend/infra) quando necessário.
3. Validar com testes de regressão:
  - upload válido permitido
  - upload inválido bloqueado
  - deleção segura sem traversal
4. Restaurar operação normal e monitorar por no mínimo 24h.

### 15.4 Evidências e auditoria

Registrar no incidente:

1. Janela de tempo (início/fim).
2. IDs afetados (empresa, usuário, endpoint).
3. Tipo de ataque/sintoma observado.
4. Ação de contenção aplicada.
5. Correção implantada e versão/commit.
6. Resultado de validação pós-correção.

### 15.5 Comunicação mínima

1. Comunicar internamente equipe técnica com impacto e status.
2. Se houver impacto real de dados/segurança, comunicar responsáveis do negócio.
3. Atualizar este documento quando o incidente gerar nova regra permanente.

---

Documento oficial de referência da infraestrutura do Kyrus ERP.

# Plano Aprovado — Chaves de API (Integrações) + Portal do Desenvolvedor

> Status: **APROVADO pelo dono do projeto**. Não é preciso pedir aprovação de novo do plano, apenas executar fase a fase.
> Este documento é a especificação. Siga-o literalmente; quando algo não estiver coberto, escolha a opção mais estrutural e registre a decisão na seção "Decisões tomadas" no final deste arquivo.

## 0. Regras invioláveis desta tarefa

1. **NÃO tocar na VPS / produção.** Proibido: `ssh`, `scp`, qualquer comando contra `103.63.28.155`, `api.kyrustech.com.br` ou `kyrustech.com.br`, `docker compose` de produção, deploy, `git push`. Tudo é **local**.
2. Não alterar `.env`, `docker-compose*.yml`, `nginx*.conf` nem arquivos em `ferramentas/`.
3. Sem gambiarra: nada de usuário "fantasma" compartilhado, nada de `if` espalhado pelos endpoints, nada de chave em texto puro no banco, nada de bypass do RBAC.
4. Seguir `.antigravityrules` (multitenancy, anti-IDOR, segredos fora de logs, edição cirúrgica).
5. Ao final de cada fase: rodar `pytest` (venv) e, quando houver frontend, `cd kyrus-web && npx tsc --noEmit`. Não avance de fase com teste quebrado. Não faça `git commit`; apenas deixe tudo pronto e informe.

---

## 1. Visão geral da arquitetura

Hoje **todos** os endpoints dependem de `get_current_user` (`app/api/deps.py`) → `Usuario`, e o contexto de empresa vem de `get_empresa_id_from_user` + RBAC (`require_permission` / `access_control_service`).

A solução estrutural é: **uma Chave de API autentica uma _conta de serviço_ (Usuario com `is_service_account=True`) vinculada a uma única empresa e a um perfil RBAC.** Assim:

- Todos os endpoints existentes continuam recebendo um `Usuario` → zero mudança nos ~25 arquivos de endpoints.
- Auditoria (`created_by`, `audit_logs`) passa a mostrar "Integração: N8N Vendas" em vez de um humano.
- Permissões reaproveitam 100% o RBAC existente (`AccessProfile` + `UserCompanyProfile`).
- Revogar a chave = desativar a chave (e a conta de serviço). Funcionário que sai da empresa não quebra integração.

Fluxo de uma requisição com chave:

```
Request (X-Api-Key: kyr_live_xxx  ou  Authorization: Bearer kyr_live_xxx)
  → get_current_user detecta prefixo "kyr_" → api_key_service.authenticate()
      → busca por key_prefix, compara hash em tempo constante
      → valida: ativa, não expirada, não revogada, empresa ativa
      → valida rota: tag da rota ∈ PUBLIC_API_TAGS (senão 403)
      → atualiza last_used_at/ip (throttle 60s)
      → retorna Usuario (conta de serviço) + grava api_key_id no contexto de auditoria
  → get_empresa_id_from_user: conta de serviço → SEMPRE user.empresa_id (ignora X-Company-ID; se vier diferente → 403)
  → require_permission: RBAC normal via UserCompanyProfile da conta de serviço
```

---

## 2. Backend

### 2.1 Modelo `ApiKey` — `app/models/api_key.py` (novo)

Tabela `api_keys`, com `AuditMixin` (como os outros modelos):

| campo | tipo | observação |
|---|---|---|
| id | int PK | |
| empresa_id | FK empresas.id, index, NOT NULL | tenant da chave |
| service_user_id | FK usuarios.id, unique, NOT NULL | conta de serviço 1:1 |
| name | str(100) | ex: "N8N Vendas" |
| description | str(255) nullable | |
| key_prefix | str(16), unique, index | primeiros chars visíveis, ex: `kyr_live_a1b2` |
| key_hash | str(64) | HMAC-SHA256(segredo, `API_KEY_PEPPER`) em hex |
| environment | str(10) | `live` ou `test` |
| profile_id | FK access_profiles.id | perfil RBAC concedido |
| expires_at | datetime nullable | opcional |
| last_used_at | datetime nullable | |
| last_used_ip | str(64) nullable | |
| revoked_at | datetime nullable | |
| revoked_by_user_id | FK usuarios.id nullable | |
| created_by_user_id | FK usuarios.id | humano que criou |
| is_active | bool default True, index | |

Registrar o modelo em `app/models/__init__.py`.

### 2.2 Conta de serviço — `Usuario.is_service_account`

- Adicionar `is_service_account: bool = Field(default=False, index=True, nullable=False)` em `app/models/usuario.py`.
- Conta criada automaticamente junto com a chave: `nome = "Integração: <name>"`, `email = "apikey+<uuid4>@service.kyrus.invalid"` (domínio `.invalid` é reservado, nunca recebe e‑mail), `hashed_password = "!"` (hash inutilizável), `email_confirmado=True`, `is_consultor=False`, `empresa_id = empresa da chave`.
- Cria `UserCompanyProfile(usuario_id=service_user, empresa_id, profile_id)`.
- **Bloqueios obrigatórios** para `is_service_account=True`:
  - `/auth/login`, `/auth/refresh`, recuperação de senha, convites, demo-login → recusar (401/403 genérico).
  - Listagens de usuários (`usuarios.py`, `rbac.py`, consultor) → filtrar `is_service_account == False`.
  - Contagens de usuários/limites de plano não contam contas de serviço.

### 2.3 Formato e geração da chave — `app/core/api_keys.py` (novo)

- Formato: `kyr_{env}_{segredo}` onde `env ∈ {live,test}` (`test` quando `ENVIRONMENT != production`) e `segredo = secrets.token_urlsafe(32)`.
- `key_prefix` = os primeiros 13 caracteres (`kyr_live_` + 4). Guardado em claro para busca e exibição.
- `key_hash = hmac.new(API_KEY_PEPPER, chave_completa, sha256).hexdigest()`. Comparação com `hmac.compare_digest`.
- Nova setting em `app/core/config.py`: `API_KEY_PEPPER: str` (default de dev; em produção, validar no `validate_security_configuration` que não é o default — igual ao `SECRET_KEY`). Adicionar em `.env.example` apenas (não mexer no `.env`).
- A chave completa é retornada **uma única vez** na criação/rotação. Nunca logar a chave nem o hash.

### 2.4 Serviço — `app/services/api_key_service.py` (novo)

Funções (transações explícitas, sem lógica nos endpoints):
- `create_api_key(db, *, empresa_id, created_by: Usuario, name, description, profile_id, expires_at) -> (ApiKey, plain_key)`
  - Validar que `profile_id` pertence à empresa (ou é template de sistema permitido) e está ativo.
  - **Anti-escalada:** as permissões do perfil escolhido devem ser ⊆ permissões efetivas do criador (`get_effective_permission_codes`). Super consultor (`*`) pode tudo. Caso contrário → 403.
  - Cria conta de serviço + `UserCompanyProfile` + `ApiKey` na mesma transação.
- `authenticate(db, plain_key, *, client_ip) -> Usuario` — busca por prefixo, compara hash, valida ativo/expiração/revogação/empresa ativa/conta de serviço ativa; atualiza `last_used_at`/`last_used_ip` com throttle de 60s. Erro sempre genérico: 401 `"Chave de API inválida"`.
- `revoke_api_key(db, *, key_id, empresa_id, revoked_by)` — desativa chave **e** conta de serviço; `invalidate_permission_cache(user_id=service_user_id)`.
- `rotate_api_key(...)` — gera novo segredo para a mesma chave (mesma conta de serviço/perfil), retorna a nova chave uma vez; a anterior deixa de funcionar imediatamente.
- `update_api_key(...)` — nome, descrição, perfil (com a mesma regra anti-escalada), expiração. Invalida cache de permissão.
- Todas as queries filtram por `empresa_id` (anti-IDOR).

### 2.5 Autenticação — alterar `app/api/deps.py`

- Em `get_current_user`: aceitar chave via header `X-Api-Key` **ou** `Authorization: Bearer kyr_...`. Se o token começa com `kyr_`, delegar para `api_key_service.authenticate` e **não** tentar decodificar JWT. Senão, fluxo JWT atual inalterado.
  - ⚠️ Não usar header `access_token` (estilo Asaas) como principal: Nginx descarta headers com underscore por padrão (`underscores_in_headers off`). Documentar `X-Api-Key` como oficial.
  - Se vierem cookie de sessão **e** chave, a chave tem prioridade e o cookie é ignorado (integrações não usam cookie).
- Guard de superfície pública: quando autenticado por chave, obter a rota (`request.scope["route"]`) e exigir que alguma tag da rota ∈ `PUBLIC_API_TAGS`; caso contrário 403 `"Este endpoint não está disponível para chaves de API"`.
- Em `get_empresa_id_from_user`: se `current_user.is_service_account` → retornar `current_user.empresa_id`; se vier `X-Company-ID` diferente → 403.
- `get_consultor_user` / `get_super_consultor_user` já barram (is_consultor=False), manter.
- Expor uma dependência `get_human_user` (rejeita conta de serviço) para endpoints que só humanos podem usar (gestão de chaves, RBAC, usuários, sessões).

### 2.6 Superfície pública — `app/core/public_api.py` (novo)

Fonte única de verdade, usada **tanto** pelo guard de autenticação **quanto** pelo OpenAPI público:

```python
PUBLIC_API_TAGS = {
  "Lançamentos", "Contas Bancárias", "Plano de Contas", "Entidades",
  "Centros de Custo", "Cartões de Crédito", "PDV", "Compras",
  "Comissões", "DRE", "Indicadores", "Planejamento Orçamentário", "Anexos",
}
```
Ficam **fora** (nunca acessíveis por chave): Autenticação, Usuários, Empresas, RBAC, Consultor, Auditoria, Integrações (contém segredos Asaas/NFStock), Importação OFX/NF-e, WebSockets, Anúncios, Machine Learning, Bancos Padrão, e o próprio `/api-keys`.
Revisar cada tag incluída: se algum endpoint dentro de uma tag pública for perigoso para integração (ex.: configuração do PDV, exclusão em massa), marcar a rota com `openapi_extra={"x-kyrus-public": False}` e fazer o guard respeitar essa exclusão.

### 2.7 Endpoints de gestão — `app/api/v1/endpoints/api_keys.py` (novo), prefixo `/api-keys`, tag `"Chaves de API"` (`include_in_schema=False`)

Todos exigem humano (`get_human_user`) + permissão `config.api_keys.manage`:
- `GET /api-keys` — lista da empresa (nunca retorna hash/segredo; retorna prefixo mascarado `kyr_live_a1b2••••`, nome, perfil, status, criada por, último uso, expiração).
- `POST /api-keys` — cria, retorna `{..., "key": "kyr_live_..."}` **uma vez**.
- `PATCH /api-keys/{id}` — nome/descrição/perfil/expiração.
- `POST /api-keys/{id}/rotate` — retorna nova chave uma vez.
- `DELETE /api-keys/{id}` — revoga (soft, mantém histórico).
- `GET /api-keys/profiles` — perfis que o usuário atual pode conceder (já filtrados pela regra anti-escalada).
Schemas em `app/schemas/api_key.py`. Registrar em `app/api/v1/api.py`.

### 2.8 RBAC

- Nova permissão `config.api_keys.manage` (module `config`, action `api_keys_manage`). Seed em `app/services/access_seed_service.py` e concedida por padrão apenas ao perfil administrador/dono da empresa.
- Criar perfis-template opcionais para integrações: **"Integração – Somente leitura"** (apenas permissões de visualização dos módulos públicos) e **"Integração – Vendas/Financeiro"** (leitura + criação de lançamentos/vendas PDV). Usar as permissões já existentes; não inventar códigos que os endpoints não checam.

### 2.9 Rate limit — `app/main.py`

- Em `rate_limit_middleware`, se houver chave (`X-Api-Key` ou Bearer `kyr_`), o bucket passa a ser `apikey:<key_prefix>` (não o IP), com limite próprio `RATE_LIMIT_API_KEY_MAX_REQUESTS` (ex.: 120/min). Não validar a chave no middleware (só usar o prefixo como identificador); a validação real é na dependência.
- Respostas 429 mantêm os headers `X-RateLimit-*`.

### 2.10 Idempotência — `check_idempotency`

Hoje `idempotency_logs.idempotency_key` é **global** (colisão entre empresas/integrações). Corrigir estruturalmente:
- Adicionar coluna `empresa_id` (nullable para registros antigos) e trocar a unicidade para `(empresa_id, idempotency_key)` via migração (PK surrogate `id` se necessário).
- `check_idempotency` passa a depender do usuário/empresa e grava/busca com `empresa_id`.
- Documentar `X-Idempotency-Key` no portal como recomendado para todos os POST de integração (n8n faz retry).

### 2.11 Auditoria

- Em `app/core/audit_context.py`, adicionar `set_audit_api_key(api_key_id)`; gravar `api_key_id` em `audit_logs` (nova coluna nullable). Assim é possível filtrar "o que a integração X fez".

### 2.12 Migração Alembic (uma só, nova)

- Verificar `alembic heads` antes (deve haver um único head; se houver mais de um, criar merge primeiro).
- Criar: tabela `api_keys`; coluna `usuarios.is_service_account` (server_default false); `audit_logs.api_key_id`; ajuste de `idempotency_logs`; seed da permissão `config.api_keys.manage`.
- `upgrade` e `downgrade` completos. Testar `alembic upgrade head` e `alembic downgrade -1` no Postgres **local**.

### 2.13 OpenAPI público — `GET /api/v1/public/openapi.json`

- Gerado com `fastapi.openapi.utils.get_openapi` usando **somente** as rotas cujas tags ∈ `PUBLIC_API_TAGS` (e não marcadas `x-kyrus-public: False`).
- Disponível também em produção (diferente do `/openapi.json` interno, que continua desligado em produção). Cache em memória após a primeira geração.
- `securitySchemes`: `ApiKeyAuth` (header `X-Api-Key`). `servers`: produção `https://api.kyrustech.com.br/api/v1` e local.
- Revisar os endpoints públicos e garantir `summary` e `description` em português, `response_model` e exemplos (`json_schema_extra`) nos schemas principais (lançamento, venda PDV, entidade, conta). Isso alimenta o portal.

### 2.14 Testes — `tests/test_api_keys.py` (novo)

Cobrir no mínimo:
1. Criar chave → resposta contém `key` uma vez; `GET` não contém `key` nem hash.
2. Requisição com `X-Api-Key` válido em rota pública → 200; com `Authorization: Bearer kyr_...` → 200.
3. Chave inválida / revogada / expirada / rotacionada (antiga) → 401.
4. Chave em rota não pública (`/usuarios`, `/rbac`, `/api-keys`, `/auth/sessions`) → 403.
5. `X-Company-ID` de outra empresa com chave → 403; dados de outra empresa nunca retornam (IDOR por ID também → 404/403).
6. Anti-escalada: usuário sem permissão X não consegue criar chave com perfil que tem X → 403.
7. Conta de serviço não consegue `/auth/login` e não aparece em listagem de usuários.
8. Idempotência: mesma `X-Idempotency-Key` em empresas diferentes não colide.
9. Auditoria registra `api_key_id`.
10. Permissão RBAC negada para a conta de serviço → 403 normal.
Rodar a suíte inteira (`pytest`) e garantir que nada existente quebrou (especialmente `test_security_multitenancy_rbac.py` e `test_idempotency.py`).

---

## 3. Frontend (kyrus-web)

### 3.1 Gestão de chaves — Configurações › Integrações

- Nova seção "Chaves de API" na aba de Integrações de `pages/Configuracoes` (seguir o padrão visual existente; componente próprio em `pages/Configuracoes/ApiKeys*.tsx`, não inchar `Configuracoes.tsx`).
- Tabela: nome, prefixo mascarado, perfil, status, último uso, expiração, criada por; ações: editar, rotacionar, revogar (com confirmação).
- Modal de criação: nome, descrição, perfil (de `/api-keys/profiles`), expiração opcional. Após criar: modal "Copie sua chave agora — ela não será exibida novamente" com botão copiar; a chave fica só em estado React e é descartada ao fechar.
- Visível somente com a permissão `config.api_keys.manage`.
- Link "Ver documentação da API" → `/developers`.

### 3.2 Portal do Desenvolvedor — rota pública `/developers` (sem login)

Layout e organização **iguais aos da documentação do Asaas**, com a marca Kyrus (cor `--color-primary` `#2563eb`, tipografia e logo do projeto, modo claro/escuro usando as variáveis de `index.css`). Pasta `kyrus-web/src/pages/Developers/`, componentes pequenos e separados.

Estrutura da tela:
- **Topbar:** logo Kyrus + "Developers", links Guias / Referência / Changelog, busca (Ctrl+K) sobre endpoints e guias, botão "Entrar" (vai para `/login`), toggle tema.
- **Sidebar esquerda:** campo Filtro; seção **Introdução** (Comece por aqui, Autenticação, Ambientes, Códigos HTTP, Listagem e paginação, Limites da API (rate limit), Idempotência, Usando com n8n); depois um grupo por recurso (tags do OpenAPI público) listando os endpoints com **badge do método** (GET verde, POST azul, PUT/PATCH roxo, DELETE vermelho).
- **Coluna central:** título do endpoint, badge do método + URL (`https://api.kyrustech.com.br/api/v1/...`), descrição, "Conteúdos relacionados", tabelas **Path Params / Query Params / Body Params** (nome, tipo, obrigatório, descrição, exemplo), **Responses** em acordeões por status (200/400/401/403/404/422/429) com schema.
- **Coluna direita (sticky):** abas de linguagem **cURL, Node, Python, PHP, n8n** (n8n = configuração do nó HTTP Request: método, URL, header `X-Api-Key`, body JSON); bloco **Credentials** com campo `X-Api-Key` (guardado só em memória, nunca em localStorage); bloco de código copiável que se atualiza com params preenchidos; botão **Try It!** que executa a requisição real contra o servidor escolhido; painel **Response** com status, tempo e JSON formatado, e chips de exemplos por status.
- Fonte dos dados: `GET /api/v1/public/openapi.json` (parser próprio leve em TS; sem Redoc/Swagger). Guias de introdução em Markdown estático (`react-markdown` já existe no projeto).
- Responsivo: em telas pequenas, sidebar vira drawer e a coluna direita desce abaixo do conteúdo.
- Adicionar a rota pública em `App.tsx` fora do `PrivateRoute`.
- Manter `/docs` (Redoc) e `/swagger` internos como estão (dev only).

### 3.3 CORS / "Try It!"

O "Try It!" do portal roda no mesmo domínio do front, então usa o proxy/URL de API já configurado. Não abrir CORS para `*` em produção por causa disso.

---

## 4. Documentação do projeto

- Atualizar `docs/Regras de Seguranca.md` (seção Chaves de API: formato, hash com pepper, escopo por tag, anti-escalada, revogação).
- Atualizar `docs/Modelos de Dados.md` (api_keys, is_service_account, idempotency e audit).
- Atualizar `docs/Fluxos e Integracoes.md` (fluxo de integração n8n).

---

## 5. Ordem de execução (fases)

1. **Fase 1 – Modelos + migração + config** (2.1, 2.2 campo, 2.3, 2.12). Validar `alembic upgrade head` local e `pytest`.
2. **Fase 2 – Serviço + autenticação + superfície pública** (2.4, 2.5, 2.6, 2.9). `pytest`.
3. **Fase 3 – Endpoints de gestão + RBAC + bloqueios da conta de serviço** (2.2 bloqueios, 2.7, 2.8). `pytest`.
4. **Fase 4 – Idempotência + auditoria** (2.10, 2.11). `pytest`.
5. **Fase 5 – Testes dedicados** (2.14). Suíte completa verde.
6. **Fase 6 – OpenAPI público + docstrings/exemplos** (2.13).
7. **Fase 7 – Frontend gestão de chaves** (3.1). `npx tsc --noEmit`.
8. **Fase 8 – Portal do Desenvolvedor** (3.2, 3.3). `npx tsc --noEmit` + `npm run build`.
9. **Fase 9 – Docs do projeto** (4) e relatório final: arquivos alterados, como testar localmente (subir backend + front, criar chave, `curl` de exemplo), pendências.

Ao terminar cada fase, escreva no chat: `FASE N CONCLUÍDA — testes: X passed` e uma lista curta dos arquivos alterados.

## Decisões tomadas
- **Falhas pré-existentes de testes (OFX)**: Os 3 testes em `tests/test_ofx_import_auto_creation.py` (`test_ofx_value_proximity_and_greedy_matching`, `test_ofx_close_date_previsto_prioritization`, `test_ofx_multiple_atrasados_only_preselects_best_match`) já falhavam antes do início da tarefa devido a datas estáticas dos mocks vs janelas relativas. Ficam fora do escopo e registrados como falhas pré-existentes. O critério de aceite para as fases foi zero novas falhas.
- **Obtenção Segura de IP (Anti-Spoofing)**: `app.core.network.get_client_ip(request)` é utilizado exclusivamente em vez de leitura manual de `X-Forwarded-For`, evitando falsificação de IP em rate limiting e auditoria.
- **Chaves de API Estritamente em Headers HTTP**: Chaves de API são aceitas unicamente via headers (`X-Api-Key` ou `Authorization: Bearer kyr_...`). A leitura via cookies (`access_token`) foi removida para eliminar superfícies de ataque CSRF.
- **Isolamento de Contas de Serviço (M2M)**: Usuários com `is_service_account=True` são bloqueados em `/auth/login`, endpoints de redefinição de senha e gestão de operadores humanos. Além disso, o validador de JWT rejeita explicitamente qualquer conta de serviço com HTTP 401.
- **Supressão de Fallback em Dev para Contas de Serviço**: O bypass de permissões existente para desenvolvimento ("sem permissões -> todas") nunca se aplica a contas de serviço; uma chave associada a um perfil vazio possui rigorosamente zero permissões.
- **Tratamento Anti-Colisão de Prefixo**: A geração e rotação de chaves realizam retry automático de até 5 tentativas para tratar colisões randômicas no índice `UNIQUE(key_prefix)`.
- **Rate Limit Dual-Bucket**: O middleware de rate limiting impõe bucket obrigatório por IP real e bucket cumulativo por prefixo da chave (`apikey:<key_prefix>`). Ambas as restrições devem ser atendidas para que a requisição prossiga.
- **Contrato Único de Resposta de Chaves**: A rota de criação e rotação retorna exclusivamente o campo `key` contendo a chave bruta, eliminando campos legados duplicados (`raw_key`).
- **Portal do Desenvolvedor Estilo Asaas**: Implementado como SPA moderna em `kyrus-web/src/pages/Developers/` com parser próprio do OpenAPI público em TypeScript, suporte a 5 linguagens (cURL, Node, Python, PHP, n8n), campo `X-Api-Key` em memória volátil e Try It! integrado ao proxy da aplicação.


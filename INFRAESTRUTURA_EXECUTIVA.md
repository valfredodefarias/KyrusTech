# Infraestrutura Executiva - Kyrus ERP

Resumo operacional em 1 página para uso diário.

## 1) Arquitetura atual

- Backend: FastAPI (container de app)
- Frontend: React/Vite (container frontend no cenário base, Nginx em prod/ssl)
- Banco principal: container standalone postgresql
- Rede crítica: kyrus_portal (externa)

Regra principal:

- O app sempre acessa banco com POSTGRES_SERVER=postgresql (DNS interno Docker)
- Não usar IP público/localhost para o banco em produção

## 2) Cenários de deploy

## Base

Arquivo: docker-compose.yml

- Serviços: backend + frontend
- Backend em redes: kyrus_portal + default

Subida:

```bash
docker compose -f docker-compose.yml up -d
```

## Produção

Arquivo: docker-compose.prod.yml (profile prod)

- Serviços: backend + nginx
- Backend em redes: kyrus_portal + kyrustech_network

Subida:

```bash
docker compose --profile prod -f docker-compose.prod.yml up -d
```

## SSL

Arquivo: docker-compose.ssl.yml

- Serviços: backend + nginx
- Backend em redes: kyrus_portal + kyrustech_network

Subida:

```bash
docker compose -f docker-compose.ssl.yml up -d
```

## CasaOS

Arquivo: docker-compose.casaos.yml

- Serviços: app + watchtower
- app em redes: kyrus_portal + default

Subida:

```bash
docker compose -f docker-compose.casaos.yml up -d
```

## 3) Pré-check obrigatório para qualquer nova feature

Antes de liberar:

1. Integridade de dados:
   - migration criada/aplicada
   - sem regressão de dados
2. Erros:
   - cenários inválidos retornam erro controlado
3. Segurança:
   - auth/autorização revisadas
   - sem credencial em log
4. Logs:
   - rastreabilidade mínima de início/fim/erro
5. Infra:
   - compose válido
   - rede válida
   - health check ok

## 4) Comandos de validação rápida

## Validar compose

```bash
docker compose -f docker-compose.yml config
docker compose --profile prod -f docker-compose.prod.yml config
docker compose -f docker-compose.ssl.yml config
docker compose -f docker-compose.casaos.yml config
```

## Validar rede externa

```bash
docker network inspect kyrus_portal
```

## Validar containers e redes

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Networks}}"
```

## Validar conexão com banco a partir do backend

```bash
docker exec -it kyrustech_backend sh -lc "getent hosts postgresql && nc -zv postgresql 5432"
```

## Validar API

```bash
curl http://localhost:8000/health
```

## 5) Variáveis críticas (.env)

```env
ENVIRONMENT=production
SECRET_KEY=<chave-forte>
BACKEND_CORS_ORIGINS=<origens-validas>
POSTGRES_SERVER=postgresql
POSTGRES_PORT=5432
POSTGRES_USER=<usuario>
POSTGRES_PASSWORD=<senha>
POSTGRES_DB=<database>
```

## 6) Critério de "OK para produção"

Release só está ok quando todos os itens abaixo estiverem verdes:

1. Health check respondendo
2. API principal da feature funcionando
3. Fluxos inválidos tratados corretamente
4. Logs úteis sem vazamento sensível
5. Compose/rede validados

## 7) Resumo de segurança e logs (atualizado)

Este é o mínimo obrigatório para qualquer alteração que envolva deploy, upload de arquivos, autenticação ou integrações:

1. CORS explícito por ambiente (sem wildcard em produção).
2. SECRET_KEY forte e exclusiva (32+ caracteres).
3. Banco acessível somente por rede Docker interna (kyrus_portal).
4. Migração executada uma única vez por startup (evitar duplicidade por compose + app).
5. Upload validado por extensão, MIME e assinatura do arquivo (magic bytes).
6. Upload bloqueia arquivo vazio e tamanho acima do limite.
7. Remoção de anexo com validação de caminho local seguro (sem path traversal).
8. Frontend aceita links de anexos/arquivos apenas de host confiável e caminho /static.
9. Logs sem credenciais, tokens, payload sensível ou conteúdo de arquivo.
10. Logs de erro com contexto mínimo: endpoint, IDs relevantes, operação e motivo técnico.
11. Gatilhos automáticos 15.1 ativos no backend:
   - rejeições repetidas por origem/endpoint
   - volume anômalo de upload por janela curta
   - tentativa de path traversal em anexo

Arquivos-chave dessa proteção:

- app/core/upload_security.py
- app/api/v1/endpoints/lancamentos.py
- app/api/v1/endpoints/anexos.py
- app/api/v1/endpoints/usuarios.py
- app/api/v1/endpoints/contas.py
- app/api/v1/endpoints/empresas.py
- kyrus-web/src/services/api.ts
- app/main.py

## 8) Checklist rápido de segurança antes do deploy

1. Rodar docker compose config em todos os cenários usados.
2. Testar upload permitido (PDF/JPG/PNG/XLS/XLSX/PPT/PPTX).
3. Testar bloqueio de extensão proibida e assinatura incompatível.
4. Testar bloqueio por tamanho excedido e arquivo vazio.
5. Testar que link externo fora do domínio confiável não é aceito no frontend.
6. Revisar logs do backend/nginx sem vazamento sensível.
7. Verificar alertas [INCIDENT_TRIGGER_15_1] nos logs após testes de carga/upload.

## 9) Referência completa

Documento completo:

- INFRAESTRUTURA.md

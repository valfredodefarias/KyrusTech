# 🚀 Manual Operacional de Deploy em Produção - KyrusERP

**Servidor de Produção Oficial**: HostHatch VPS (`103.63.28.155`)  
**Diretório da Aplicação**: `/root/KyrusERP`  
**Domínios Oficiais**: `kyrustech.com.br` (Frontend) e `api.kyrustech.com.br` (Backend API)  
**Última Atualização**: Setembro de 2026

---

## ⚠️ Regra de Ouro da Infraestrutura

> [!CRITICAL]
> **Use SEMPRE o `docker-compose.yml` padrão.**
> **NUNCA utilize `docker-compose.prod.yml` no servidor.**  
> O arquivo `docker-compose.prod.yml` contém definições obsoletas e redes legadas (`kyrustech_network`) que causam desconexão do banco de dados, conflitos de bridge no Docker daemon e indisponibilidade do sistema. A infraestrutura de produção utiliza a orquestração do `docker-compose.yml` em conjunto com o Nginx Proxy Manager.

---

## 🏛️ Filosofia de Engenharia: Desenvolvimento Estrutural, Zero Gambiarras

Todo deploy em produção deve cumprir rigorosamente os seguintes critérios:
1. **Zero Falsos Registros**: Nunca criar produtos com ID 0 ou pedidos de venda falsos para contornar limitações de caixa ou de conciliação.
2. **Separação de Domínios**:
   - Venda de Balcão (`venda_service.py`)
   - Movimentação de Caixa e Sangrias (`caixa_service.py`)
   - Cartões e Adquirentes (`cartao_service.py`)
   - Estoque e Custo Médio (`estoque_service.py`)
   - Marketplace iFood (`ifood_service.py`)
3. **Cálculo Monetário Exato**: Rateios de parcelas devem sempre usar centavos inteiros (`money.ts`), evitando erros de ponto flutuante.
4. **Proteção no Banco**: Unicidade de contas, produtos, regras de cartão e usuários via índices únicos parciais (`WHERE is_deleted = false`).
5. **Caches Limpos**: Proibido implementar temporizadores no frontend que forcem dados obsoletos sobre a resposta da API.

---

## 📦 Arquitetura dos Contêineres no Servidor

| Contêiner | Imagem | Porta Host | Redes Conectadas | Função |
| :--- | :--- | :--- | :--- | :--- |
| `db_kyrustech` | `postgres:17-alpine` | `5432` | `kyrus_db_internal` | Banco de Dados PostgreSQL 17 |
| `redis_kyrustech` | `redis:7-alpine` | `6379` | `kyrus_db_internal` | Cache, filas e WebSockets |
| `kyrustech_backend` | `kyruserp-backend:latest` | `8000` | `kyrus_portal`, `kyrus_db_internal` | API FastAPI (4 workers Uvicorn) |
| `kyrustech_frontend` | `node:20-alpine` | `3000` | `kyruserp_default` | Vite Server (`allowedHosts: true`) |
| `nginxproxymanager` | `jc21/nginx-proxy-manager` | `80`, `443`, `81` | `bridge` / Host | Proxy Reverso com SSL Let's Encrypt |

---

## 🛡️ Protocolo Obrigatório de Backup Pré-Deploy

**ANTES de rodar `git pull` ou reiniciar contêineres**, execute um dump completo da base de produção:

```bash
# Conectar via SSH
ssh root@103.63.28.155

# Acessar a pasta do projeto
cd /root/KyrusERP

# Gerar o backup no formato Custom (-Fc)
docker exec db_kyrustech pg_dump -U kyrus_Ciro -Fc -f /tmp/backup_erp.dump kyrus_erp

# Copiar para o disco local do host com data e hora
docker cp db_kyrustech:/tmp/backup_erp.dump ./backup_erp_$(date +%Y%m%d_%H%M%S).dump

# Confirmar se o arquivo foi criado com sucesso (tamanho típico ~150 MB)
ls -lh backup_erp_*.dump | tail -n 2
```

---

## 🚀 Passo a Passo de Atualização em Produção

Após commitar e validar todas as alterações localmente (`pytest` e `npm run build` aprovados):

### Passo 1: Enviar os Commits para o GitHub
Na sua máquina de desenvolvimento:
```powershell
git push origin main
```

### Passo 2: Conectar ao Servidor
```bash
ssh root@103.63.28.155
cd /root/KyrusERP
```

### Passo 3: Executar o Backup de Segurança
Execute o comando do protocolo de backup acima.

### Passo 4: Atualizar o Código-Fonte
```bash
git pull origin main
```

### Passo 5: Reconstruir o Backend
```bash
docker compose up -d --build backend
```

### Passo 6: Reconstruir e Reiniciar o Frontend
```bash
docker compose up -d --build --force-recreate frontend
```

### Passo 7: Validação e Health Check
Verifique se os serviços responderam adequadamente:
```bash
# 1. Healthcheck do Backend
curl -s http://localhost:8000/health
# Resposta esperada: {"status":"ok","message":"API is running","server_timezone":"America/Sao_Paulo"}

# 2. Resposta do Frontend
curl -s -I http://localhost:3000
# Resposta esperada: HTTP/1.1 200 OK

# 3. Teste do Domínio Público via HTTPS
curl -s -I https://kyrustech.com.br/contas
# Resposta esperada: HTTP/2 200
```

---

## 🔧 Troubleshooting e Resolução de Problemas Comuns

### 1. `Blocked request. This host ("kyrustech.com.br") is not allowed`
- **Causa**: O Vite dev server possui bloqueio de segurança contra requisições que chegam com cabeçalho `Host` não registrado.
- **Solução**: Garantir que o arquivo `kyrus-web/vite.config.ts` possua `allowedHosts: true` na seção `server`:
  ```ts
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    ...
  }
  ```
- Em seguida, reinicie o container: `docker restart kyrustech_frontend`.

### 2. Erro de DNS / Nome de Rede (`could not translate host name "db_kyrustech"`)
- **Causa**: O container do backend foi iniciado sem estar conectado à rede `kyrus_db_internal`.
- **Solução**:
  ```bash
  docker network connect kyruserp_kyrus_db_internal db_kyrustech
  docker network connect kyruserp_kyrus_db_internal kyrustech_backend
  docker restart kyrustech_backend
  ```

### 3. Conflito de Nome de Container (`Conflict. The container name "/kyrustech_frontend" is already in use`)
- **Causa**: Um container parado ou órfão ainda detém o nome no daemon.
- **Solução**:
  ```bash
  docker rm -f kyrustech_frontend
  docker compose up -d frontend
  ```

### 4. Consultar Logs em Tempo Real
```bash
# Logs do backend (últimas 50 linhas com follow)
docker logs -f --tail 50 kyrustech_backend

# Logs do frontend
docker logs -f --tail 50 kyrustech_frontend

# Logs do banco de dados
docker logs -f --tail 50 db_kyrustech
```

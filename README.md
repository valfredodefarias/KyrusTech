# 📘 KyrusERP - Arquitetura Corporativa e Guia de Operação

Documentação técnica completa e diretrizes de engenharia: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)  
Guia de Deploy em Produção e Servidor: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)  
Manual de Backups e Restauração: [docs/MANUAL_RESTAURACAO_BACKUP.md](docs/MANUAL_RESTAURACAO_BACKUP.md)

---

## 🏛️ Diretriz Inegociável: Desenvolvimento Estrutural, Zero Gambiarras

Todo e qualquer desenvolvimento no KyrusERP deve seguir princípios rígidos de engenharia de software corporativo. **Gambiarras e paliativos temporários são terminantemente proibidos.**

1. **Integridade de Dados e Modelagem Limpa**:
   - É estritamente proibido criar registros falsos ou "fantasmas" no banco de dados para contornar limitações de tela (ex.: **nunca** criar ordens de venda falsas ou produtos com ID 0 para acomodar movimentações avulsas de caixa). Cada domínio tem seu próprio ciclo de vida.
2. **Separação Rígida de Domínios**:
   - O monolito do PDV foi erradicado e dividido em serviços especialistas em `app/services/pdv/`:
     - `venda_service.py`: Vendas de balcão e produtos.
     - `caixa_service.py`: Abertura, fechamento, suprimentos e sangrias de caixa em perna dupla.
     - `cartao_service.py`: Regras de taxas, prazos de liquidação e agenda de recebíveis.
     - `estoque_service.py`: Movimentação de estoque e custo médio ponderado.
     - `ifood_service.py`: Marketplace e comissões.
3. **Aritmética Financeira em Centavos**:
   - Cálculos monetários e divisões de parcelas **nunca** devem utilizar ponto flutuante puro (IEEE-754) que gere dízimas como `R$ 33,333333`. Todas as operações de rateio devem usar aritmética de centavos inteiros via `kyrus-web/src/utils/money.ts`.
4. **Gerenciamento de Estado Confiável no Frontend**:
   - Nunca criar caches voláteis com timers artificiais (ex.: `setTimeout` de 30s) que forcem dados antigos por cima da resposta atualizada do servidor.
5. **Proteção de Unicidade no Banco com Soft Delete**:
   - Garantir unicidade via índices únicos parciais no PostgreSQL (`WHERE is_deleted = false`), impedindo duplicidade física de cadastros.

---

## 🖥️ Topologia de Servidor e Produção

- **Servidor de Produção**: VPS HostHatch dedicada (`103.63.28.155`).
- **Orquestração**: Docker Compose padrão (`docker-compose.yml`), operando com:
  - **Backend (`kyrustech_backend`)**: FastAPI, Python 3.11+, 4 workers Uvicorn, conectado às redes `kyrus_portal` e `kyrus_db_internal`.
  - **Frontend (`kyrustech_frontend`)**: Node 20, Vite Server com `allowedHosts: true` (porta 3000).
  - **Banco de Dados (`db_kyrustech`)**: PostgreSQL 17 Alpine em rede interna segura `kyrus_db_internal`.
  - **Cache/Fila (`redis_kyrustech`)**: Redis 7 Alpine para WebSockets e filas de background.
  - **Proxy Reverso e SSL**: Nginx Proxy Manager (OpenResty) gerenciando certificados Let's Encrypt para `kyrustech.com.br` e `api.kyrustech.com.br`.

> [!WARNING]
> Em produção, utilize **sempre** o `docker-compose.yml` padrão. **Não** utilize `docker-compose.prod.yml`, pois ele introduz definições divergentes de redes e contêineres que conflitam com a infraestrutura ativa.

---

## 💾 Protocolo de Segurança e Backups

Antes de qualquer deploy, migração de banco ou refatoração crítica, é **obrigatório** gerar um backup da base de dados:

```bash
# SSH no servidor
ssh root@103.63.28.155

# Gerar dump consistente com timestamp
cd /root/KyrusERP
docker exec db_kyrustech pg_dump -U kyrus_Ciro -Fc -f /tmp/backup_erp.dump kyrus_erp
docker cp db_kyrustech:/tmp/backup_erp.dump ./backup_erp_$(date +%Y%m%d_%H%M%S).dump
```

Para restauração completa, consulte o [MANUAL_RESTAURACAO_BACKUP.md](docs/MANUAL_RESTAURACAO_BACKUP.md).

---

## 🚀 Workflow de Desenvolvimento e Deploy

### Rodar Localmente
```bash
# 1. Iniciar containers de apoio (banco e redis)
docker compose up -d db_kyrustech redis

# 2. Backend (ambiente virtual)
source .venv/bin/activate  # ou .venv\Scripts\activate no Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Frontend
cd kyrus-web
npm install
npm run dev
```

### Rodar a Suíte de Testes
```bash
python -m pytest tests/test_all_payment_methods_pdv.py tests/test_pdv_conciliacao.py tests/test_movimentacao_pdv.py -v
```

### Deploy em Produção
Consulte o passo a passo seguro em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
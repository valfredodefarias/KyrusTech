# 📘 KyrusERP - Arquitetura Corporativa e Guia de Operação

Documentação técnica completa e diretrizes de engenharia: [docs/ARCHITECTURE.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/ARCHITECTURE.md)  
Guia de Infraestrutura e Startup: [docs/ARQUITETURA_E_STARTUP.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/ARQUITETURA_E_STARTUP.md)  
Guia de Deploy em Produção e Servidor: [docs/DEPLOYMENT.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/DEPLOYMENT.md)  
Manual de Backups e Restauração: [docs/MANUAL_RESTAURACAO_BACKUP.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/MANUAL_RESTAURACAO_BACKUP.md)  
Regras de Segurança e Anti-IDOR: [docs/Regras de Seguranca.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Regras%20de%20Seguranca.md)  
Catálogo de Modelos (48 Entidades): [docs/Modelos de Dados.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Modelos%20de%20Dados.md)

---

## 🏛️ Diretrizes Inegociáveis de Engenharia

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
3. **Multitenancy Canônico e Proteção Anti-IDOR**:
   - Todo endpoint de negócio deve utilizar `Depends(get_empresa_id_from_user)` em vez de `current_user.empresa_id`, garantindo compatibilidade com o header `X-Company-ID` para consultores multiempresa e impedindo acesso cruzado entre organizações.
4. **Durabilidade ACID Estrita no Banco de Dados**:
   - PostgreSQL 17 configurado com `synchronous_commit=on`. Todas as operações financeiras e de caixa gravam no Write-Ahead Log (WAL) antes de retornar confirmação, prevenindo perda de dados em quedas de energia.
5. **Aritmética Financeira em Centavos**:
   - Cálculos monetários e divisões de parcelas **nunca** devem utilizar ponto flutuante puro (IEEE-754) que gere dízimas como `R$ 33,333333`. Todas as operações de rateio devem usar aritmética de centavos inteiros via `kyrus-web/src/utils/money.ts`.
6. **Gerenciamento de Estado Confiável no Frontend**:
   - Sem loops de referências em mocks de seletores do Zustand e desacoplamento de dependências circulares entre stores via listeners funcionais.

---

## 🖥️ Topologia de Servidor e Produção

- **Servidor de Produção**: VPS HostHatch dedicada (`103.63.28.155`).
- **Orquestração**: Docker Compose padrão (`docker-compose.yml`), operando com:
  - **Backend (`kyrustech_backend`)**: FastAPI, Python 3.11+, 4 workers Uvicorn, conectado às redes `kyrus_portal` e `kyrus_db_internal`.
  - **Frontend (`kyrustech_frontend`)**: Node 20, Vite Server com `allowedHosts: true` (porta 3000).
  - **Banco de Dados (`db_kyrustech`)**: PostgreSQL 17 Alpine com 48 modelos mapeados no Alembic e durabilidade WAL ativa (`synchronous_commit=on`).
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
docker exec db_kyrustech pg_dump -U kyrus_user -Fc -f /tmp/backup_erp.dump kyrus_erp
docker cp db_kyrustech:/tmp/backup_erp.dump ./backup_erp_$(date +%Y%m%d_%H%M%S).dump
```

Para restauração completa, consulte o [MANUAL_RESTAURACAO_BACKUP.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/MANUAL_RESTAURACAO_BACKUP.md).

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

### Rodar as Suítes de Testes
```bash
# Backend (76 testes passando)
pytest -q

# Frontend (25 testes passando em 7 suítes)
cd kyrus-web
npm test
npm run build
```

### Deploy em Produção
Consulte o passo a passo seguro em [docs/DEPLOYMENT.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/DEPLOYMENT.md).
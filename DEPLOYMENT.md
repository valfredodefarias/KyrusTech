# 🚀 Kyrus ERP - Configuração e Deploy

Referências de infraestrutura:

- Manual de Arquitetura e Infraestrutura completo: [ARCHITECTURE.md](ARCHITECTURE.md)

## 📋 Pré-requisitos

- Docker & Docker Compose
- Node.js 20+ (para compilar frontend)
- Python 3.11+ (opcional, para desenvolvimento local)

## 🔧 Configuração Local

### 1. Clone o projeto
```bash
git clone <seu-repositorio> kyrus-erp
cd kyrus-erp
```

### 2. Configure as variáveis de ambiente
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
nano .env
```

### 3. Compile o Frontend
```bash
cd kyrus-web
npm install
npm run build
cd ..
```

### 4. Inicie a aplicação

#### Desenvolvimento:
```bash
docker-compose up -d
# ou use o script
python run.py
```

#### Produção:
```bash
docker-compose -f docker-compose.prod.yml --profile prod up -d
```

## 📝 Configuração de Variáveis de Ambiente

As seguintes variáveis devem ser configuradas no `.env`:

### Geral
- `PROJECT_NAME`: Nome do projeto (default: Kyrus ERP)
- `ENVIRONMENT`: `development`, `production` ou `testing`

### Segurança
- `SECRET_KEY`: Chave secreta para JWT (mínimo 32 caracteres)
- `ACCESS_TOKEN_EXPIRE_MINUTES`: Tempo de expiração do token
- `ALGORITHM`: Algoritmo JWT (default: HS256)
- `BACKEND_CORS_ORIGINS`: URLs de CORS (separadas por vírgula)

### Banco de Dados
- `POSTGRES_SERVER`: Host do PostgreSQL
- `POSTGRES_PORT`: Porta (default: 5432)
- `POSTGRES_USER`: Usuário do banco
- `POSTGRES_PASSWORD`: Senha do banco
- `POSTGRES_DB`: Nome do banco
- `POSTGRES_ALLOWED_CIDRS`: Lista separada por vírgula para gerar regras de acesso administrativo no `pg_hba.conf`

No compose atual, o backend fala com o serviço `db_kyrustech` na porta interna `5432`, e a porta exposta no host fica em `5444` por padrão.

Se precisar acessar o banco por DBeaver, inclua na lista a subnet do Docker usada pelo app e os IPs/CIDRs administrativos autorizados.

### AWS S3 (Opcional)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET_NAME`
- `AWS_S3_REGION`

## 🔑 Gerar Secret Key em Produção

```bash
# Linux/Mac
openssl rand -hex 32

# Windows PowerShell
[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

## 📊 Estrutura do Projeto

```
kyrus-erp/
├── app/                 # Backend FastAPI
│   ├── api/            # Rotas da API
│   ├── crud/           # Operações de banco
│   ├── db/             # Configuração do banco
│   ├── models/         # Modelos SQLModel
│   ├── schemas/        # Schemas Pydantic
│   ├── services/       # Lógica de negócio
│   └── core/           # Configuração e utilidades
├── kyrus-web/          # Frontend React + Vite
│   ├── src/
│   ├── dist/           # Build de produção
│   └── package.json
├── alembic/            # Migrations do banco
├── scripts/            # Scripts de inicialização
├── docker-compose.yml  # Dev
├── docker-compose.prod.yml  # Production
├── Dockerfile          # Backend
└── nginx.conf          # Proxy reverso (produção)
```

## 🚀 Deploy no HostHatch

### 1. Prepare o servidor
```bash
# SSH no servidor
ssh root@seu-ip-hosthatch

# Instale Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Clone o projeto
git clone <seu-repositorio> kyrus-erp
cd kyrus-erp
```

### 2. Configure o ambiente
```bash
# Crie o arquivo .env
cp .env.example .env

# Edite com suas configurações
nano .env

# Gere uma SECRET_KEY forte
openssl rand -hex 32
```

### 3. Compile o frontend
```bash
cd kyrus-web
npm install
npm run build
cd ..
```

### 4. Inicie a aplicação
```bash
# Usando o script de deploy
bash scripts/deploy.sh

# Ou manualmente
docker-compose -f docker-compose.prod.yml --profile prod up -d
```

### 5. Configure o domínio (opcional)
```bash
# Se quiser usar um domínio, configure um reverse proxy com SSL
# Use Nginx ou Let's Encrypt com Certbot

sudo apt install certbot python3-certbot-nginx
sudo certbot certonly --standalone -d seu-dominio.com
```

## 📱 URLs da Aplicação

Após iniciar:
- Frontend: `http://seu-servidor:3000` ou `http://seu-dominio`
- API Backend: `http://seu-servidor:8000/api/v1`
- Docs: `http://seu-servidor:8000/docs`
- Health Check: `http://seu-servidor:8000/health`

## 🔄 Migrações do Banco

```bash
# Criar nova migration
docker-compose exec backend alembic revision --autogenerate -m "Descrição"

# Aplicar migrations
docker-compose exec backend alembic upgrade head

# Reverter última migration
docker-compose exec backend alembic downgrade -1
```

## 📊 Ver Logs

```bash
# Todos os containers
docker-compose logs -f

# Apenas backend
docker-compose logs -f backend

# Apenas banco de dados
docker-compose logs -f db

# Apenas frontend
docker-compose logs -f frontend
```

## 🛑 Parar a Aplicação

```bash
# Modo desenvolvimento
docker-compose down

# Modo produção
docker-compose -f docker-compose.prod.yml --profile prod down
```

## 🗑️ Remover Dados (CUIDADO!)

```bash
# Remove containers, networks e volumes
docker-compose down -v

# Remove também imagens
docker-compose down -v --rmi all
```

## 🐛 Troubleshooting

### Erro de conexão com banco de dados
```bash
# Verifique as variáveis de ambiente
cat .env | grep POSTGRES

# Reinicie o container do banco
docker-compose restart db

# Verifique os logs
docker-compose logs db
```

### Frontend não carrega
```bash
# Verifique se foi compilado
ls kyrus-web/dist

# Se não existir, compile
cd kyrus-web && npm run build

# Recrie o container do nginx
docker-compose down
docker-compose up -d
```

### Erro de permissões
```bash
# Se tiver erro de permissão com volumes
sudo chown -R 1000:1000 static/
sudo chown -R 1000:1000 postgres_data/
```

## 📞 Suporte

Para problemas ou dúvidas, verifique:
1. Os logs: `docker-compose logs -f`
2. O arquivo .env está correto
3. As portas 80, 3000, 8000 não estão em uso
4. Tem espaço em disco disponível

---

**Versão**: 1.0.0  
**Última atualização**: 2024

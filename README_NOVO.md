# 🏢 Kyrus ERP

Sistema de Gestão Empresarial (ERP) com frontend em React + TypeScript e backend em FastAPI.

## ✨ Características

- ✅ Backend em FastAPI com autenticação JWT
- ✅ Banco de dados PostgreSQL com Alembic migrations
- ✅ Frontend moderno em React 19 + TypeScript + Vite
- ✅ CORS e segurança configuráveis
- ✅ Docker & Docker Compose para fácil deploy
- ✅ Suporte a S3 AWS para upload de arquivos
- ✅ Variáveis de ambiente para configuração automática
- ✅ Documentação automática com Swagger/OpenAPI

## 📦 Stack Tecnológico

### Backend
- **FastAPI** - Framework web moderno
- **SQLModel** - ORM com suporte a type hints
- **PostgreSQL** - Banco de dados relacional
- **Alembic** - Migrations de banco de dados
- **JWT** - Autenticação segura
- **Pydantic** - Validação de dados

### Frontend
- **React 19** - Biblioteca UI
- **TypeScript** - Type safety
- **Vite** - Build tool rápido
- **React Router** - Navegação
- **Axios** - HTTP client
- **Zustand** - State management
- **Tailwind CSS** - Styling

## 🚀 Quick Start

### Desenvolvimento Local

```bash
# 1. Clone o repositório
git clone <seu-repositorio>
cd kyrus-erp

# 2. Gere o arquivo .env
python scripts/generate_env.py

# 3. Edite as variáveis conforme necessário
nano .env

# 4. Compile o frontend
cd kyrus-web
npm install
npm run build
cd ..

# 5. Inicie com Docker
docker-compose up -d

# Ou para desenvolvimento com hot reload:
# Terminal 1 - Backend
python run.py

# Terminal 2 - Frontend
cd kyrus-web
npm run dev
```

### Acesso

- **Frontend**: http://localhost:3000
- **API Backend**: http://localhost:8000
- **Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

## 📝 Configuração

### Variáveis de Ambiente Essenciais

```env
# Geral
PROJECT_NAME=Kyrus ERP
ENVIRONMENT=development

# Segurança (gere com: openssl rand -hex 32)
SECRET_KEY=<sua-chave-aleatoria-aqui>

# Banco de Dados
POSTGRES_SERVER=localhost
POSTGRES_PORT=5432
POSTGRES_USER=kyrus_user
POSTGRES_PASSWORD=kyrus_pass
POSTGRES_DB=kyrus_db

# CORS
BACKEND_CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

Veja `.env.example` para todas as opções disponíveis.

## 🐳 Docker

### Desenvolvimento
```bash
docker-compose up -d
docker-compose logs -f
```

### Produção
```bash
docker-compose -f docker-compose.prod.yml --profile prod up -d
```

## 📚 Documentação Completa

Veja [DEPLOYMENT.md](./DEPLOYMENT.md) para:
- Deploy em produção
- Configuração de domínio e SSL
- Troubleshooting
- Scripts auxiliares

## 🗂️ Estrutura do Projeto

```
kyrus-erp/
├── app/                    # Backend FastAPI
│   ├── api/               # Rotas da API
│   ├── crud/              # Operações CRUD
│   ├── db/                # Configuração do banco
│   ├── models/            # Modelos SQLModel
│   ├── schemas/           # Schemas Pydantic
│   ├── services/          # Lógica de negócio
│   └── core/              # Config, security, etc
├── kyrus-web/             # Frontend React
│   ├── src/
│   │   ├── components/    # Componentes React
│   │   ├── pages/         # Páginas
│   │   ├── services/      # API services
│   │   └── store/         # Estado global
│   └── dist/              # Build de produção
├── alembic/               # Migrations
├── scripts/               # Scripts auxiliares
├── frontend/              # Frontend legado (deprecado)
└── docker-compose.yml     # Configuração Docker
```

## 🔄 Migrations do Banco

```bash
# Criar nova migration
docker-compose exec backend alembic revision --autogenerate -m "Descrição"

# Aplicar migrations
docker-compose exec backend alembic upgrade head

# Ver status das migrations
docker-compose exec backend alembic current
```

## 📖 API Documentation

A documentação interativa está disponível em:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## 🛠️ Desenvolvimento

### Adicionar nova dependência backend
```bash
pip install nova-lib
pip freeze > requirements.txt
docker-compose build
```

### Adicionar nova dependência frontend
```bash
cd kyrus-web
npm install nova-lib
docker-compose build frontend
```

### Criar novo endpoint
1. Crie o arquivo em `app/api/v1/endpoints/`
2. Importe em `app/api/v1/api.py`
3. Inclua na aplicação

### Criar novo modelo
1. Crie o arquivo em `app/models/`
2. Importe em `alembic/env.py`
3. Execute: `alembic revision --autogenerate`
4. Execute: `alembic upgrade head`

## 🔐 Segurança

- Senhas com hash bcrypt
- JWT com expiração configurável
- CORS restritivo em produção
- Validação de entrada com Pydantic
- Rate limiting (opcional)

## 📊 Monitoramento

```bash
# Ver logs em tempo real
docker-compose logs -f

# Ver logs de um serviço específico
docker-compose logs -f backend
docker-compose logs -f db
docker-compose logs -f frontend

# Verificar saúde dos containers
docker-compose ps
```

## 🐛 Troubleshooting

### Porta já em uso
```bash
# Encontre o processo usando a porta
lsof -i :8000  # ou :3000, :5432

# Altere as portas no docker-compose.yml
```

### Banco de dados não conecta
```bash
# Reinicie o container do banco
docker-compose restart db

# Verifique as credenciais em .env
# Aguarde alguns segundos para o banco inicializar
sleep 5
```

### Frontend em branco
```bash
# Verifique se foi compilado
ls kyrus-web/dist/

# Se não: compile
cd kyrus-web && npm run build

# Verifique a URL da API no .env
cat kyrus-web/.env
```

## 📝 License

Propriedade privada

## 👨‍💻 Contribuindo

1. Crie uma branch para sua feature
2. Commit suas mudanças
3. Push e crie um Pull Request

---

**Status**: Ativo em desenvolvimento  
**Última atualização**: Enero 2026

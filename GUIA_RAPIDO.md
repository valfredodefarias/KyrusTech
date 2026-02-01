# 🎯 KYRUS ERP - Guia Rápido Visual

## 📌 Arquivos Mais Importantes (para você)

```
kyrus-erp/
├── 🟢 .env.example          ← COPIE PARA .env E PREENCHA!
├── 🟢 quick-start.sh        ← Execute isto (Linux/Mac)
├── 🟢 quick-start.bat       ← Execute isto (Windows)
├── 📘 README_NOVO.md        ← Leia isto primeiro
├── 📘 DEPLOYMENT.md         ← Leia para deploy
├── 📘 TROUBLESHOOTING.md    ← Leia se tiver problemas
├── 📘 DEPLOY_CHECKLIST.md   ← Use para produção
├── 📘 RESUMO_MUDANCAS.md    ← O que foi feito
│
├── docker-compose.yml       ← Desenvolvimento
├── docker-compose.prod.yml  ← Produção (sem SSL)
├── docker-compose.ssl.yml   ← Produção (com HTTPS)
├── Dockerfile              ← Build backend
├── nginx.conf              ← Proxy Nginx
├── nginx-ssl.conf          ← Proxy Nginx + HTTPS
│
├── app/
│   ├── main.py            ← Aplicação FastAPI
│   ├── core/config.py     ← Variáveis de ambiente
│   ├── core/logging.py    ← Logs (dev/prod)
│   ├── db/session.py      ← Banco de dados
│   ├── api/v1/            ← Rotas da API
│   ├── models/            ← Modelos do banco
│   ├── crud/              ← Operações no banco
│   └── services/          ← Lógica de negócio
│
├── kyrus-web/
│   ├── Dockerfile         ← Build frontend
│   ├── vite.config.ts     ← Configuração Vite
│   ├── package.json       ← Dependências Node
│   ├── .env              ← Variáveis frontend
│   ├── src/              ← Código React
│   └── dist/             ← Build production
│
├── scripts/
│   ├── generate_env.py    ← Gera .env com SECRET_KEY
│   ├── deploy.sh         ← Deploy automático
│   ├── setup-ssl.sh      ← Configura SSL/HTTPS
│   └── create_admin.py   ← Cria usuário admin
│
└── alembic/              ← Migrations do banco
    └── versions/

---

## ✅ Ambiente Python (Compatibilidade)
Para dev local com Python 3.13, use os pins do requirements.txt (SQLAlchemy 2.0.46, Pydantic 2.12.x e psycopg2-binary 2.9.11) para evitar builds nativos.
```

---

## 🚀 Passo 1: Desenvolvimento Local (5 minutos)

### Linux/Mac
```bash
./quick-start.sh
# Pronto! Acesse http://localhost:3000
```

### Windows
```bash
quick-start.bat
# Pronto! Acesse http://localhost:3000
```

**O que acontece automaticamente:**
1. ✅ Cria `.env` se não existir
2. ✅ Compila frontend (npm run build)
3. ✅ Build Docker images
4. ✅ Inicia containers (docker-compose up -d)
5. ✅ Mostra URLs de acesso

---

## 🌐 Passo 2: Acessar a Aplicação

| URL | O quê |
|-----|-------|
| http://localhost:3000 | 💻 Frontend (Interface) |
| http://localhost:8000 | ⚙️ Backend API |
| http://localhost:8000/docs | 📖 Documentação (Swagger) |
| http://localhost:8000/health | 🟢 Health Check |

---

## 🔧 Passo 3: Configurar (Importante!)

```bash
# 1. Edite o arquivo .env
nano .env  # Linux/Mac
notepad .env  # Windows

# 2. Preencha os valores obrigatórios:
#    - SECRET_KEY (gere com: openssl rand -hex 32)
#    - POSTGRES_PASSWORD (senhas da produção)
#    - BACKEND_CORS_ORIGINS (URLs permitidas)

# 3. Salve e reinicie
docker-compose restart backend
```

---

## 🚀 Passo 4: Deploy no HostHatch

### A. Preparar Servidor

```bash
# 1. SSH no servidor
ssh root@seu-ip

# 2. Instalar Docker
curl -fsSL https://get.docker.com | sudo sh

# 3. Instalar Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. Instalar Node.js (opcional, só se quiser build no servidor)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash
sudo apt-get install -y nodejs
```

### B. Clone e Configure

```bash
# 1. Clone do Git
git clone seu-repositorio
cd kyrus-erp

# 2. Gere .env
python3 scripts/generate_env.py

# 3. Configure valores
nano .env
# Edite:
# - SECRET_KEY (novo, aleatório)
# - POSTGRES_PASSWORD (novo, forte)
# - BACKEND_CORS_ORIGINS (seu domínio)
# - ENVIRONMENT=production

# 4. Compile frontend
cd kyrus-web
npm install
npm run build
cd ..
```

### C. Deploy

```bash
# Opção 1: Sem HTTPS (não recomendado)
docker-compose -f docker-compose.prod.yml --profile prod up -d

# Opção 2: Com HTTPS (RECOMENDADO!)
bash scripts/setup-ssl.sh seu-dominio.com seu-email@exemplo.com

# Aguarde 1-2 minutos para inicializar
docker-compose logs -f
```

---

## 🎯 URLs em Produção

Substitua `seu-dominio.com` pelo seu domínio:

```
https://seu-dominio.com              ← Frontend
https://seu-dominio.com/api/v1       ← API
https://seu-dominio.com/docs         ← Documentação
https://seu-dominio.com/health       ← Health check
```

---

## 📊 Verificações Rápidas

### 1. Verificar Status dos Containers
```bash
docker-compose ps
# Deve mostrar: backend, frontend, db (all UP)
```

### 2. Testar API
```bash
curl http://seu-ip:8000/health
# Resposta: {"status":"ok","message":"API is running"}
```

### 3. Ver Logs
```bash
# Todos os logs
docker-compose logs -f

# Apenas backend
docker-compose logs -f backend

# Apenas banco
docker-compose logs -f db
```

### 4. Parar Tudo
```bash
docker-compose down
```

---

## 🔐 Variáveis Críticas

⚠️ **Estas variáveis DEVEM ser alteradas em produção:**

```env
# Gerar nova com: openssl rand -hex 32
SECRET_KEY=seu-valor-aleatorio-aqui-min-32-caracteres

# Senha super segura!
POSTGRES_PASSWORD=sua-senha-forte-12345

# Seu domínio (sem https://)
BACKEND_CORS_ORIGINS=seu-dominio.com,www.seu-dominio.com

# production ou development
ENVIRONMENT=production
```

---

## 🆘 Problemas Frequentes

| Problema | Solução |
|----------|---------|
| `Connection refused` | Aguarde 15s, banco ainda iniciando |
| `Port already in use` | Mude porta em docker-compose.yml |
| `CORS error` | Edite BACKEND_CORS_ORIGINS em .env |
| `Frontend branco` | Execute `npm run build` no kyrus-web |
| `403 Forbidden` | Permissões de arquivo, `chown -R 1000:1000` |
| `Out of memory` | Aumentar RAM do container ou do servidor |

Veja `TROUBLESHOOTING.md` para mais soluções.

---

## 📈 Próximas Melhorias (Opcional)

1. **Monitoramento**
   - Prometheus + Grafana
   - NewRelic ou DataDog

2. **Backups**
   - Automated PostgreSQL backups
   - AWS S3 storage

3. **Email**
   - SendGrid ou Mailgun
   - Notificações de erro

4. **CI/CD**
   - GitHub Actions
   - Auto-deploy no push

5. **Cache**
   - Redis para sessões
   - Caching de queries

---

## 📚 Documentação Completa

- **Rápido**: Este arquivo (GUIA_RAPIDO.md)
- **Detalhado**: `DEPLOYMENT.md`
- **Problemas**: `TROUBLESHOOTING.md`
- **Produção**: `DEPLOY_CHECKLIST.md`
- **O que mudou**: `RESUMO_MUDANCAS.md`
- **Projeto**: `README_NOVO.md`

---

## 🎉 Sucesso!

Se você conseguir:
1. ✅ Ver frontend em http://localhost:3000
2. ✅ Acessar API em http://localhost:8000/docs
3. ✅ Logar com credenciais
4. ✅ Fazer um CRUD básico

Parabéns! 🎊 Seu projeto está **100% pronto para produção**!

---

## 💡 Dicas Finais

### Desenvolvimento
- Use `docker-compose logs -f` para debug
- Altere `ENVIRONMENT=development` em `.env` para logs detalhados
- Vite live reload funciona em hot reload

### Produção
- Sempre use HTTPS (SSL)
- Configure backups do banco
- Monitore logs regularmente
- Renove certificados SSL (automático com Let's Encrypt)

### Segurança
- Nunca commite `.env` no Git
- Gere SECRET_KEY aleatório
- Use senhas fortes
- Mantenha dependências atualizadas

---

**Pronto? Vamos começar! 🚀**

```bash
# Linux/Mac
./quick-start.sh

# Windows
quick-start.bat
```

Depois de 2-3 minutos, acesse: **http://localhost:3000**


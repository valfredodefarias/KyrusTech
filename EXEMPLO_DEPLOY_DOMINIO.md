# 🌐 KYRUS ERP - Exemplo de Deploy com Domínio

## Scenario: Deploy no HostHatch com seu próprio domínio

Este exemplo mostra um deploy real com:
- Domínio: `meuprojeto.com`
- IP do servidor: `185.12.34.56`
- Email: `admin@meuprojeto.com`

---

## ✅ Passo-a-Passo Completo

### 1️⃣ Preparar o Servidor (10 minutos)

```bash
# SSH no servidor
ssh root@185.12.34.56

# Atualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker root

# Instalar Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verificar instalações
docker --version
docker-compose --version
node --version
npm --version
```

### 2️⃣ Configurar Domínio DNS (5 minutos)

No seu DNS provider (GoDaddy, Namecheap, etc):

```
Tipo     | Nome              | Valor
---------|-------------------|----------
A        | meuprojeto.com    | 185.12.34.56
A        | www.meuprojeto.com | 185.12.34.56
CNAME    | api.meuprojeto.com | meuprojeto.com
```

**⏳ Aguarde 15-30 minutos para propagar**

Teste: `ping meuprojeto.com` deve responder

### 3️⃣ Clone e Configure o Projeto (10 minutos)

```bash
# Clone
git clone https://github.com/seu-usuario/kyrus-erp.git
cd kyrus-erp

# Gere SECRET_KEY
openssl rand -hex 32
# Output exemplo: 3f8a2b9c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f

# Crie .env com as configurações
cat > .env << 'EOF'
# Geral
PROJECT_NAME=Kyrus ERP
ENVIRONMENT=production

# Segurança (cole o valor gerado acima)
SECRET_KEY=3f8a2b9c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f

# Token JWT
ACCESS_TOKEN_EXPIRE_MINUTES=60
ALGORITHM=HS256

# CORS - URLs autorizadas
BACKEND_CORS_ORIGINS=https://meuprojeto.com,https://www.meuprojeto.com

# Banco de Dados
POSTGRES_SERVER=db
POSTGRES_PORT=5432
POSTGRES_USER=kyrus_user
POSTGRES_PASSWORD=SuaSenhaForte123!@#
POSTGRES_DB=kyrus_db

# AWS S3 (deixe em branco se não usar)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET_NAME=
AWS_S3_REGION=
EOF

# Verifique o arquivo
cat .env
```

### 4️⃣ Compile o Frontend (5 minutos)

```bash
cd kyrus-web
npm install
npm run build
cd ..

# Verifique se o build foi criado
ls -la kyrus-web/dist/ | head -5
```

### 5️⃣ Configure SSL com Let's Encrypt (5 minutos)

```bash
# Prepare o script
nano scripts/setup-ssl.sh
# (Ou use seu editor preferido)

# Execute o setup
bash scripts/setup-ssl.sh meuprojeto.com admin@meuprojeto.com

# Isso vai:
# 1. Gerar certificado SSL válido
# 2. Salvar em ./certs
# 3. Configurar nginx-ssl.conf
# 4. Iniciar containers com HTTPS
```

### 6️⃣ Inicie a Aplicação (5 minutos)

```bash
# Com HTTPS (recomendado)
docker-compose -f docker-compose.ssl.yml up -d

# Ou manualmente
docker-compose -f docker-compose.prod.yml --profile prod up -d

# Aguarde inicializar
sleep 10

# Verifique status
docker-compose ps

# Deve mostrar:
# kyrus_db_ssl        postgres:15-alpine  Up
# kyrus_backend_ssl   (Your image)        Up
# kyrus_nginx_ssl     nginx:alpine        Up
```

### 7️⃣ Teste a Aplicação (5 minutos)

```bash
# Health check
curl https://meuprojeto.com/health
# Resposta esperada: {"status":"ok","message":"API is running"}

# API disponível?
curl -I https://meuprojeto.com/api/v1
# Status: 200 OK

# Frontend carrega?
curl https://meuprojeto.com | grep -i "react\|kyrus" | head -3
```

### 8️⃣ Criar Usuário Admin (5 minutos)

```bash
# Entrar no container do backend
docker-compose exec backend bash

# Criar usuário admin (dentro do container)
python scripts/create_admin.py

# Sair
exit
```

Isso vai criar um usuário:
- **Email**: admin@kyrus.com (você pode mudar)
- **Senha**: (será pedida durante execução)

### 9️⃣ Verificações Finais

```bash
# Ver logs em tempo real
docker-compose logs -f

# Deve mostrar:
# backend     | ✅ Banco de dados inicializado com sucesso
# backend     | 🚀 KYRUS ERP - INICIANDO BACKEND
# nginx       | (nginx started successfully)

# Health check
curl -v https://meuprojeto.com/health

# Testar login na API
curl -X POST https://meuprojeto.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@kyrus.com","password":"sua-senha"}'
```

### 🔟 Configurar Backups Automáticos (10 minutos)

```bash
# Criar script de backup
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Backup do banco
docker-compose exec -T db pg_dump -U kyrus_user -d kyrus_db > $BACKUP_DIR/kyrus_$TIMESTAMP.sql

# Comprimir
gzip $BACKUP_DIR/kyrus_$TIMESTAMP.sql

# Limpar backups antigos (> 7 dias)
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "✅ Backup realizado: $BACKUP_DIR/kyrus_$TIMESTAMP.sql.gz"
EOF

chmod +x backup.sh

# Agendar backup diário com crontab
(crontab -l 2>/dev/null; echo "0 2 * * * /root/kyrus-erp/backup.sh") | crontab -

# Verificar agendamento
crontab -l
```

---

## 🎯 Resultado Final

Após completar tudo, você terá:

```
🌐 Frontend:      https://meuprojeto.com
⚙️  Backend API:    https://meuprojeto.com/api/v1
📖 Documentação:   https://meuprojeto.com/docs
🔐 SSL:            Válido por 90 dias (auto-renova)
💾 Banco:          PostgreSQL rodando em Docker
📊 Logs:           Disponíveis via docker-compose logs
🔄 Backups:        Automáticos a cada 2 AM
```

---

## 🔄 Manutenção Diária

### Ver Logs
```bash
# Últimas 50 linhas
docker-compose logs --tail=50

# Acompanhar em tempo real
docker-compose logs -f

# Apenas backend
docker-compose logs -f backend
```

### Reiniciar Serviço
```bash
# Apenas backend
docker-compose restart backend

# Todos
docker-compose restart

# Parar tudo
docker-compose down

# Reiniciar tudo
docker-compose up -d
```

### Verificar Recursos
```bash
# CPU e memória
docker-compose stats

# Espaço em disco
df -h /

# Tamanho do banco
docker-compose exec -T db du -sh /var/lib/postgresql/data
```

---

## 🔐 Segurança em Produção

### ✅ Checklist de Segurança

```bash
# 1. Verificar que .env não foi commitado
git status .env
# Deve mostrar: "nothing to commit"

# 2. Verificar permissões
ls -la .env
# Deve mostrar: -rw------- (600)
chmod 600 .env

# 3. Verificar que SECRET_KEY é forte
cat .env | grep SECRET_KEY
# Deve ter > 32 caracteres aleatórios

# 4. Verificar que HTTPS está ativo
curl -I https://meuprojeto.com
# Status: 200 (não 403 ou 502)

# 5. Verificar certificado SSL
curl -v https://meuprojeto.com 2>&1 | grep -A 3 "SSL certificate"
# Deve mostrar: "certificate verify ok"
```

---

## 🚨 Troubleshooting em Produção

### Certificado SSL expirou?
```bash
# Renovar manualmente
bash scripts/setup-ssl.sh meuprojeto.com admin@meuprojeto.com
```

### Banco não conecta?
```bash
# Reiniciar banco
docker-compose restart db
sleep 15
docker-compose restart backend
```

### Sem espaço em disco?
```bash
# Limpar Docker
docker system prune -a --volumes

# Ou verificar logs antigos
docker-compose logs --tail=0 -f  # Não mostra histórico
```

### Aplicação lenta?
```bash
# Ver recursos
docker-compose stats

# Aumentar workers no backend
# Edite docker-compose.yml:
# command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 8
```

---

## 📞 Suporte Rápido

| Problema | Comando |
|----------|---------|
| Ver todos logs | `docker-compose logs -f` |
| Ver apenas erros | `docker-compose logs 2>&1 \| grep -i error` |
| Status dos containers | `docker-compose ps` |
| Parar tudo | `docker-compose down` |
| Reiniciar backend | `docker-compose restart backend` |
| Ver recursos | `docker-compose stats` |
| Backup manual | `docker-compose exec db pg_dump...` |

---

## 🎉 Parabéns!

Você tem um **KYRUS ERP em produção**, com:
- ✅ HTTPS automático
- ✅ Banco de dados PostgreSQL
- ✅ Frontend React moderno
- ✅ API REST documentada
- ✅ Backups automáticos
- ✅ Certificado SSL renovável

**URL para acessar**: https://meuprojeto.com

Divirta-se! 🚀


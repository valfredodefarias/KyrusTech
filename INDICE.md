# 📑 KYRUS ERP - Índice de Documentação

## 🎯 Comece Aqui

### Para Iniciantes
1. **[GUIA_RAPIDO.md](GUIA_RAPIDO.md)** ⭐ **COMECE AQUI**
   - Visual e direto ao ponto
   - Passo-a-passo ilustrado
   - Tabelas de referência rápida

### Para Desenvolvimento Local
2. **[README_NOVO.md](README_NOVO.md)**
   - Overview do projeto
   - Stack tecnológico
   - Estrutura de pastas
   - Como contribuir

### Para Deploy em Produção
3. **[DEPLOYMENT.md](DEPLOYMENT.md)**
   - Guia detalhado passo-a-passo
   - Configuração avançada
   - Deploy no HostHatch
   - Migrações do banco

### Com Domínio e HTTPS
4. **[EXEMPLO_DEPLOY_DOMINIO.md](EXEMPLO_DEPLOY_DOMINIO.md)**
   - Exemplo real com domínio
   - Configuração DNS
   - SSL com Let's Encrypt
   - Backups automáticos

---

## 🔧 Documentação Técnica

### Configuração
- **[.env.example](.env.example)** - Variáveis de ambiente
- **[docker-compose.yml](docker-compose.yml)** - Dev
- **[docker-compose.prod.yml](docker-compose.prod.yml)** - Prod
- **[docker-compose.ssl.yml](docker-compose.ssl.yml)** - Prod + HTTPS

### Código
- **[app/main.py](app/main.py)** - Aplicação FastAPI
- **[app/core/config.py](app/core/config.py)** - Configuração com env vars
- **[app/db/session.py](app/db/session.py)** - Conexão do banco
- **[kyrus-web/vite.config.ts](kyrus-web/vite.config.ts)** - Config do frontend

---

## 🚀 Scripts Úteis

### Inicialização Rápida
```bash
# Linux/Mac
./quick-start.sh

# Windows
quick-start.bat
```

### Verificar Arquivos
```bash
python check_files.py
```

### Deploy Automático
```bash
bash scripts/deploy.sh
```

### Configurar SSL
```bash
bash scripts/setup-ssl.sh seu-dominio.com seu-email@exemplo.com
```

### Gerar .env
```bash
python scripts/generate_env.py
```

---

## 📖 Guias Específicos

### Para Diferentes Situações

#### 1. Apenas Desenvolvimento Local
→ [GUIA_RAPIDO.md](GUIA_RAPIDO.md) + [README_NOVO.md](README_NOVO.md)

#### 2. Deploy em Servidor sem Domínio
→ [DEPLOYMENT.md](DEPLOYMENT.md) + docker-compose.prod.yml

#### 3. Deploy em Servidor com Domínio e SSL
→ [EXEMPLO_DEPLOY_DOMINIO.md](EXEMPLO_DEPLOY_DOMINIO.md) + docker-compose.ssl.yml

#### 4. Preciso Debugar/Solucionar Problemas
→ [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

#### 5. Vou para Produção, Preciso Checklist
→ [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)

#### 6. Quero Saber o Que Mudou
→ [RESUMO_MUDANCAS.md](RESUMO_MUDANCAS.md)

---

## 🔍 Encontre o Que Precisa

### "Como faço para..."

| Tarefa | Arquivo |
|--------|---------|
| Começar rápido | [GUIA_RAPIDO.md](GUIA_RAPIDO.md) |
| Fazer deploy | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Usar domínio | [EXEMPLO_DEPLOY_DOMINIO.md](EXEMPLO_DEPLOY_DOMINIO.md) |
| Resolver problema | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Ver o que mudou | [RESUMO_MUDANCAS.md](RESUMO_MUDANCAS.md) |
| Checklist prod | [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) |
| Entender projeto | [README_NOVO.md](README_NOVO.md) |
| Configurar .env | [.env.example](.env.example) |

---

## 📚 Todos os Documentos

### Documentação de Projeto
- 📖 [README_NOVO.md](README_NOVO.md) - Overview
- 🔧 [RESUMO_MUDANCAS.md](RESUMO_MUDANCAS.md) - O que foi feito

### Guias de Implementação
- 🚀 [GUIA_RAPIDO.md](GUIA_RAPIDO.md) - Start rápido
- 📘 [DEPLOYMENT.md](DEPLOYMENT.md) - Deploy detalhado
- 🌐 [EXEMPLO_DEPLOY_DOMINIO.md](EXEMPLO_DEPLOY_DOMINIO.md) - Com domínio

### Referência Técnica
- 🔍 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Solução de problemas
- ✅ [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) - Pré-produção

### Configuração
- 🔧 [.env.example](.env.example) - Variáveis
- 🐳 [docker-compose.yml](docker-compose.yml) - Docker dev
- 🐳 [docker-compose.prod.yml](docker-compose.prod.yml) - Docker prod
- 🐳 [docker-compose.ssl.yml](docker-compose.ssl.yml) - Docker prod+SSL

### Scripts
- 🚀 [quick-start.sh](quick-start.sh) - Iniciar (Linux/Mac)
- 🚀 [quick-start.bat](quick-start.bat) - Iniciar (Windows)
- 🔧 [run.py](run.py) - Backend
- 🔧 [scripts/generate_env.py](scripts/generate_env.py) - Gera .env
- 🔧 [scripts/deploy.sh](scripts/deploy.sh) - Deploy automático
- 🔧 [scripts/setup-ssl.sh](scripts/setup-ssl.sh) - Configura SSL

---

## 🎓 Fluxo de Aprendizado

### Iniciante
1. Leia [GUIA_RAPIDO.md](GUIA_RAPIDO.md)
2. Execute `./quick-start.sh`
3. Explore em http://localhost:3000
4. Leia [README_NOVO.md](README_NOVO.md)

### Intermediário
1. Leia [DEPLOYMENT.md](DEPLOYMENT.md)
2. Entenda [docker-compose.yml](docker-compose.yml)
3. Configure seu `.env`
4. Teste em servidor local

### Avançado
1. Leia [EXEMPLO_DEPLOY_DOMINIO.md](EXEMPLO_DEPLOY_DOMINIO.md)
2. Configure SSL
3. Configure backups
4. Monitore produção
5. Consulte [TROUBLESHOOTING.md](TROUBLESHOOTING.md) conforme necessário

---

## ⚡ Cheat Sheet Rápido

### Primeiro Acesso
```bash
./quick-start.sh
# Aguarde 3 minutos
# Abra http://localhost:3000
```

### Verificar Status
```bash
docker-compose ps
docker-compose logs -f
```

### Parar/Reiniciar
```bash
docker-compose down
docker-compose up -d
```

### Produção
```bash
docker-compose -f docker-compose.prod.yml --profile prod up -d
# ou
bash scripts/deploy.sh
```

### SSL
```bash
bash scripts/setup-ssl.sh seu-dominio.com seu-email@exemplo.com
```

---

## 🎯 Objetivos Alcançados

✅ Projeto configurável por variáveis de ambiente  
✅ Docker otimizado para produção  
✅ Frontend React integrado  
✅ HTTPS/SSL pronto  
✅ Documentação completa  
✅ Scripts de automação  
✅ Guias passo-a-passo  
✅ Troubleshooting detalhado  
✅ Exemplo com domínio real  
✅ Checklist de produção  

---

## 📞 Suporte Rápido

| Situação | Ação |
|----------|------|
| Não sabe por onde começar | Leia [GUIA_RAPIDO.md](GUIA_RAPIDO.md) |
| Quer fazer deploy | Leia [DEPLOYMENT.md](DEPLOYMENT.md) |
| Tem problema | Leia [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Vai para produção | Use [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) |
| Quer entender o projeto | Leia [README_NOVO.md](README_NOVO.md) |
| Quer exemplo real | Leia [EXEMPLO_DEPLOY_DOMINIO.md](EXEMPLO_DEPLOY_DOMINIO.md) |

---

## 🚀 Próximo Passo

**👉 Comece pelo [GUIA_RAPIDO.md](GUIA_RAPIDO.md)!**

Lá tem tudo para você começar em menos de 5 minutos.

---

**Versão**: 1.0.0  
**Data**: Janeiro 2026  
**Status**: ✅ Pronto para Produção


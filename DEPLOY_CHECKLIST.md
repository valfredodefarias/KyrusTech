# ✅ KYRUS ERP - Checklist de Deploy

## 🔍 Pré-Deploy (Local)

- [ ] Todos os testes passam
- [ ] Código foi revisado
- [ ] Variáveis de ambiente estão configuradas
- [ ] Frontend foi compilado (`npm run build`)
- [ ] Migrations estão atualizadas
- [ ] Docker está instalado
- [ ] Espaço em disco suficiente (mínimo 2GB)

## 🖥️ Preparação do Servidor (HostHatch)

### Acesso SSH
- [ ] IP do servidor está acessível
- [ ] Chave SSH está configurada
- [ ] Conexão SSH funciona

### Dependências
- [ ] Docker instalado (`curl -fsSL https://get.docker.com | sh`)
- [ ] Docker Compose instalado
- [ ] Node.js 20+ instalado (para build do frontend)
- [ ] Git instalado

### Repositório
- [ ] Repositório Git está acessível
- [ ] Clone funcionou sem erros
- [ ] Branch principal está atualizado

## 🔐 Configuração de Segurança

- [ ] `SECRET_KEY` gerado com `openssl rand -hex 32`
- [ ] `POSTGRES_PASSWORD` alterada de valor padrão
- [ ] `BACKEND_CORS_ORIGINS` configurado para seu domínio
- [ ] `.env` está em `.gitignore` (não foi commitado)
- [ ] `.env` no servidor é diferente do `.env.example`
- [ ] Permissões de arquivos corretas (`chmod 600 .env`)

## 📦 Build e Compilação

- [ ] `docker-compose build` executado sem erros
- [ ] Frontend compilado: `cd kyrus-web && npm run build`
- [ ] Tamanho do build é razoável (< 500MB)
- [ ] Imagens Docker foram criadas

## 🗄️ Banco de Dados

- [ ] PostgreSQL está iniciando corretamente
- [ ] Migrations executam sem erros
- [ ] Tabelas foram criadas no banco
- [ ] Volume PostgreSQL está mapeado corretamente
- [ ] Backup automático está configurado (opcional)

## 🌐 Conectividade

- [ ] Porta 8000 (backend) está aberta
- [ ] Porta 3000 (frontend) está aberta
- [ ] Porta 5432 (banco) está fechada externamente
- [ ] Firewall foi configurado corretamente
- [ ] CORS está funcionando (testar requisição do frontend)

## 🚀 Deployment

### Inicialização
- [ ] `docker-compose up -d` foi executado
- [ ] Todos os containers estão em `UP`
- [ ] Health check passou: `curl http://localhost:8000/health`

### Verificação
- [ ] Frontend carrega: `http://seu-dominio:3000`
- [ ] API responde: `curl http://seu-dominio:8000/api/v1`
- [ ] Docs acessível: `http://seu-dominio:8000/docs`
- [ ] Login funciona
- [ ] Operações CRUD funcionam

## 🔍 Monitoramento

- [ ] Logs estão sendo capturados: `docker-compose logs`
- [ ] Sem erros críticos nos logs
- [ ] CPU não está em 100%
- [ ] Memória disponível
- [ ] Disco não está cheio

## 🌐 Domínio e SSL (Opcional)

- [ ] Domínio aponta para o IP do servidor
- [ ] SSL/HTTPS configurado (Let's Encrypt)
- [ ] Redirecionamento HTTP → HTTPS
- [ ] Certificado está válido
- [ ] Renovação automática está configurada

## 📊 Backup e Recuperação

- [ ] Backup do banco de dados configurado
- [ ] Volume PostgreSQL tem espaço suficiente
- [ ] Procedimento de recuperação testado
- [ ] Cronograma de backup definido

## 📝 Documentação

- [ ] DEPLOYMENT.md foi lido
- [ ] Instruções de acesso estão claras
- [ ] Equipe foi notificada
- [ ] Credenciais de admin foram criadas
- [ ] Documentação da API foi gerada

## 🎯 Pós-Deploy

- [ ] Aplicação testada em produção
- [ ] Logs monitorados por 24 horas
- [ ] Alertas de erro configurados
- [ ] Backup inicial realizado
- [ ] Plano de rollback pronto

## 🛑 Rollback (Se Necessário)

- [ ] Versão anterior está tagueada no Git
- [ ] Backup do banco pode ser restaurado
- [ ] Volumes estão versionados
- [ ] Procedimento de rollback testado

---

## 📞 Contatos de Emergência

- DevOps: _________________
- Admin: _________________
- Suporte: _________________

## 📅 Histórico de Deploy

| Data | Versão | Resultado | Notas |
|------|--------|-----------|-------|
|      |        |           |       |
|      |        |           |       |

---

**Status**: [ ] Pronto para produção

**Data do Deploy**: _______________

**Responsável**: _______________

**Assinado**: _______________

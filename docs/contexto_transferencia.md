# Contexto de Transferência (Resumo para o Próximo Chat)

Este documento serve para passar o bastão de forma 100% autônoma para a próxima sessão de chat da inteligência artificial, economizando tokens e garantindo que o agente execute as tarefas com precisão.

---

## 📂 Arquivos de Referência no Workspace

O próximo agente deve ler e seguir os seguintes planos já estruturados no seu workspace:
1. [docs/implementation_plan.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/implementation_plan.md): Contém a lista de todos os arquivos a modificar no Frontend, Backend e Docker, as estratégias de prefetching, Keep-Alive de abas, indexação e timeouts.
2. [docs/security_audit.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/security_audit.md): Contém o detalhamento técnico e a justificativa das 4 correções críticas de segurança no módulo de PDV (Bypass de autorização).

---

## 🎯 Instruções de Execução Rápida (Para o Agente da Próxima Sessão)

Quando o chat for reiniciado, o novo agente deve:
1. **Ler o plano de execução** presente em `docs/implementation_plan.md` e `docs/security_audit.md`.
2. **Criar a lista de tarefas** (`task.md`) na pasta de artefatos para guiar o checklist.
3. **Iniciar a codificação** seguindo os blocos de modificação indicados:
   - **Backend**: Inserir timeouts de conexão no Postgres (`session.py`), preloading de baixas (N+1) em `lancamentos.py`, throttling de sessão de 5 min em `deps.py`, cache de preflight de CORS e threads de indexação compostos em `main.py`, comandos do Postgres em `docker-compose`.
   - **Backend Segurança**: Inserir validações de permissões (`PDV_CANCELAR_VENDA`, `PDV_REALIZAR_SANGRIA`, `page:configuracoes:view` e propriedade de vendas) no arquivo `pdv.py`.
   - **Frontend**: Implementar Keep-Alive de abas e auto-reload de ChunkLoadError em `Layout.tsx`, corrigir mês dinâmico em `ConciliacaoCartoes.tsx`, adicionar retries de requisição de rede em `api.ts`, atualizar store do Zustand com BroadcastChannel payload em `transactionStore.ts` e sync de lookups em `lookupStore.ts`, e ajustar o design vertical do Boletim em `Boletim.tsx`.
4. **Validar**: Rodar testes e benchmarks para certificar a eficiência.

---

## 💬 Mensagem para Copiar e Colar no Início do Novo Chat:

> "Por favor, leia os arquivos `docs/contexto_transferencia.md`, `docs/implementation_plan.md` e `docs/security_audit.md` presentes no workspace. Eles contêm todo o planejamento técnico detalhado das otimizações de performance (0ms), resiliência a deploys e segurança de controle de acesso (PDV) que alinhamos. Crie o arquivo de tarefas (`task.md`) e inicie a execução da Fase de Implementação imediatamente."

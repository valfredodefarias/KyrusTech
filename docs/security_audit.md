# Auditoria de Segurança & Relatório de Mitigações (Kyrus ERP)

**Última Atualização**: 26 de Setembro de 2026  
**Status**: Todas as vulnerabilidades críticas auditadas foram **100% CORRIGIDAS E TESTADAS**.

Esta auditoria detalha o histórico de vulnerabilidades de controle de acesso (Bypass de Permissão, IDOR e Isolamento Multi-tenant) identificadas nos módulos PDV, Cartões e Comissões, e as correções estruturais aplicadas no backend.

---

## 🛑 1. Vulnerabilidades no Módulo PDV ([pdv.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/pdv.py)) — [RESOLVIDAS]

### 1.1 Bypass de Cancelamento de Venda (`PATCH /vendas/{venda_id}/status`) — **CORRIGIDO**
- **A Brecha**: O endpoint que alterava o status para `CANCELADO` ou `DEVOLVIDO` não checava permissões de gerência.
- **Correção Aplicada**: Validação das permissões efetivas do usuário (`get_effective_permission_codes`). Operadores sem `PDV_CANCELAR_VENDA` ou `*` recebem `HTTP 403 Forbidden`. O cancelamento também valida `Venda.empresa_id == empresa_id`.

### 1.2 Bypass de Edição de Venda de Outros Operadores (`PUT /vendas/{venda_id}`) — **CORRIGIDO**
- **A Brecha**: Operadores comuns podiam alterar vendedores ou itens de vendas de terceiros.
- **Correção Aplicada**: Checagem de propriedade da venda (`venda.vendedor_id == current_user.id`) ou permissão `PDV_VER_TODAS_VENDAS` / `*`. Inclusão de filtro estrito por `empresa_id`.

### 1.3 Bypass de Sangria de Caixa (`POST /sangrias`) — **CORRIGIDO**
- **A Brecha**: Sangria de caixa acessível sem verificação de permissão.
- **Correção Aplicada**: Exigência expressa da permissão `PDV_REALIZAR_SANGRIA` ou `*`. Vinculação automática com a `empresa_id` resolvida no header corporativo.

### 1.4 Bypass de Configurações Financeiras do PDV (`PUT /config`) — **CORRIGIDO**
- **A Brecha**: Parâmetros bancários e fiscais do PDV podiam ser alterados sem perfil de gestão.
- **Correção Aplicada**: Exigência de privilégio administrativo `page:configuracoes:view` ou `*`.

---

## 🛡️ 2. Resolução de IDOR e Multitenancy nos Módulos Cartões, Comissões e PDV — [RESOLVIDOS]

### 2.1 Módulo Cartões ([cartoes.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/cartoes.py))
- **Brecha Anterior**: Endpoints utilizavam `current_user.empresa_id` em vez de `Depends(get_empresa_id_from_user)`. Ao trocar de empresa no header `X-Company-ID` como consultor corporativo, as operações operavam sobre a empresa default do usuário, criando divergência de tenant.
- **Correção Aplicada**:
  - Todas as rotas agora injetam `empresa_id: int = Depends(get_empresa_id_from_user)`.
  - Operações de `atualizar_cartao` (`PUT /{cartao_id}`), `deletar_cartao` (`DELETE /{cartao_id}`) e `upload_xlsx` foram blindadas com verificação dupla: `Cartao.id == cartao_id` e `Cartao.empresa_id == empresa_id`.
  - O endpoint de upload de planilha foi convertido para rota síncrona com pool de execução (`def upload_xlsx`), eliminando travamento do event loop do FastAPI durante leitura de arquivos pesados via `openpyxl`.

### 2.2 Módulo Comissões ([comissoes.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/comissoes.py))
- **Brecha Anterior**: Relatórios, listagens de vendedores, fechamento de comissões e regras utilizavam `current_user.empresa_id` e faziam atualizações de fechamento apenas com `ComissaoFechamento.id == id`.
- **Correção Aplicada**:
  - Injeção obrigatória de `empresa_id: int = Depends(get_empresa_id_from_user)`.
  - `confirmar_fechamento`, `cancelar_fechamento` e `detalhes_fechamento` agora validam `ComissaoFechamento.empresa_id == empresa_id`.
  - Criação de novos fechamentos e lançamentos vinculados no financeiro são atribuídos estritamente à `empresa_id` resolvida.

### 2.3 Módulo Configuração de Comissões ([comissao_config.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/comissao_config.py))
- **Brecha Anterior**: `PUT /config` e endpoints de taxas de vendedor utilizavam `current_user.empresa_id`.
- **Correção Aplicada**: Todas as rotas de configuração agora utilizam `Depends(get_empresa_id_from_user)`, garantindo que cada filial ou empresa gerenciada tenha suas taxas configuradas isoladamente.

---

## 📋 3. Diagnóstico de Outros Recursos de Segurança

- **Resolvedor de Multitenancy (`deps.py:get_empresa_id_from_user`)**: Valida se o cabeçalho `X-Company-ID` pertence às empresas vinculadas ao usuário (via tabela `usuario_empresas` ou vínculo direto). Se for enviado um ID de empresa não autorizada, o resolvedor rejeita o cabeçalho e recai para a empresa oficial do usuário, prevenindo acesso cruzado.
- **Validação de Assinatura de Arquivos (`upload_security.py`)**: Implementa verificação de Magic Bytes (assinatura binária) para `.png`, `.pdf`, `.jpeg`, `.xlsx`, evitando injeção de arquivos maliciosos ou scripts executáveis disfarçados.
- **Validação de Token JWT**: Validação de expiração (`exp`) e assinatura segura `HS256` utilizando chave secreta carregada estritamente via variável de ambiente.
- **Garantia ACID no Banco de Dados**: Configurado `synchronous_commit=on` no PostgreSQL 17 em containers de desenvolvimento e produção, garantindo durabilidade das transações de auditoria e financeiro.

---

## 🔒 4. Vulnerabilidades Estruturais e de Autorização Resolvidas nesta Auditoria

### 4.1 Resolução de Tenant em Verificação de Permissão (`deps.py:require_permission`)
- **Problema**: `require_permission`, `require_any_permission` e `get_current_user_permission_codes` chamavam `get_empresa_id_from_user` sem fornecer o objeto `request`. O sistema avaliava as permissões do usuário contra sua empresa padrão do banco em vez da empresa selecionada via cabeçalho `X-Company-ID`, causando elevação de privilégios ou bloqueios indevidos para consultores multi-empresa.
- **Solução**: Passagem obrigatória de `request=request` nos interceptores de permissão e integração de ContextVar `_http_request` no middleware para capturar a requisição automaticamente.

### 4.2 Lançamentos Financeiros e Importação Inteligente (`lancamentos.py`)
- **Problema**: Rotas de CRUD individual, operações em lote (`criar_multiplos`, `deletar_multiplos`, `baixar_multiplos`, `atualizar_multiplos`, `transferir_valores`), upload de comprovantes e importação de planilhas (`analisar_arquivo_importacao`, `importar_executar`, `importar_executar_async`) chamavam `require_empresa_user(current_user)` que retornava diretamente `current_user.empresa_id`, ignorando o cabeçalho corporativo `X-Company-ID`.
- **Solução**: `require_empresa_user` foi expandido para aceitar `empresa_id: Optional[int]`. Todas as rotas de lançamentos e importações agora injetam `empresa_id: int = Depends(get_empresa_id_from_user)`.

### 4.3 Controle de Acesso e Proteção de Upload em Cartões (`cartoes.py`)
- **Problema**:
  - `create_lancamento_cartao`, `bulk_create_lancamento_cartao`, `update_lancamento_cartao` e `delete_lancamento_cartao` não possuíam dependências de permissão RBAC.
  - `upload_xlsx` aceitava qualquer arquivo e tamanho sem checar permissões, gerando risco de DoS/exaustão de memória via upload de planilhas imensas ou maliciosas.
- **Solução**:
  - Adicionadas dependências RBAC: `lancamentos:create`, `lancamentos:update` e `lancamentos:delete`.
  - No `upload_xlsx`: validação obrigatória de permissão (`require_any_permission`), validação de extensão (`.xlsx`, `.xls`) e corte com `HTTP 413` se o arquivo exceder 10MB.

### 4.4 Atribuição de Auditoria e Contexto HTTP Global (`audit_context.py` & `deps.py`)
- **Problema**: Quando um consultor atuava sob uma empresa filial via `X-Company-ID`, o resolvedor de tenant não sincronizava o ContextVar de auditoria `_empresa_id`, registrando os logs com a empresa matriz do consultor.
- **Solução**: `get_empresa_id_from_user` agora sincroniza automaticamente `set_audit_empresa(empresa_id)` e `session.info["audit_empresa_id"] = empresa_id`. Um ContextVar `_http_request` foi acoplado ao `audit_context_middleware` para resolver o `Request` globalmente mesmo em chamadas aninhadas.

### 4.5 Consulta de Perfil do Usuário Ativo (`usuarios.py:read_user_me`)
- **Problema**: `GET /users/me` chamava `get_empresa_id_from_user` sem o `request`, devolvendo a empresa e as permissões fixas da matriz mesmo quando o cabeçalho `X-Company-ID` solicitava contexto da filial.
- **Solução**: Injeção de `request: Request` em `read_user_me`, permitindo que o frontend carregue instantaneamente o perfil e as permissões corretas para a empresa em foco.

### 4.6 Proteção Contra DoS / Exaustão de Memória em Uploads de Arquivo
- **Problema**: `file.file.read()` e `arquivo.file.read()` eram executados sem limites em buffers na memória em múltiplos endpoints (`compras.py`, `importacao_nfe.py`, `importacao_ofx.py`, `lancamentos.py`). Em alguns endpoints, a validação de tamanho ocorria após carregar todo o arquivo para a memória RAM.
- **Solução**:
  - Implementada leitura limitada por chunks/bounds (`file.file.read(LIMIT + 1)`).
  - Retorno imediato de `HTTP 413 Payload Too Large` sem alocar buffers gigantes na RAM.
  - Validação estrita de extensões permitidas (`.xml`, `.ofx`, `.xlsx`, `.xls`).

### 4.7 Proteção de Informações Financeiras Confidenciais DRE e Orçamentos (`dre.py` & `orcamentos.py`)
- **Problema**:
  - `GET /api/v1/dre/` e `GET /api/v1/dre/anual` não exigiam `require_permission("page:dre:view")`, expondo margens operacionais e DRE a usuários não privilegiados.
  - `POST /api/v1/orcamentos/batch` e `GET /api/v1/orcamentos/matriz/{ano}` permitiam manipulação e consulta de metas orçamentárias anuais sem controle de permissão RBAC.
- **Solução**: Injeção da dependência `require_permission("page:dre:view")` nos quatro endpoints.

### 4.8 Proteção de Dados Bancários e Contas a Receber (`integracao_bancaria.py`)
- **Problema**: Endpoints de leitura de integrações bancárias (`GET /`, `GET /{id}`, `GET /{id}/mapeamentos`, `GET /{id}/tipos-asaas`, `GET /{id}/asaas/cobrancas`, `GET /{id}/asaas/assinaturas`, `GET /{id}/asaas/contas-receber`, `GET /{id}/asaas/saldo`) não possuíam dependências de permissão RBAC, permitindo que operadores comuns visualizassem saldos bancários, inadimplência e clientes do Asaas.
- **Solução**: Injeção de dependências `require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view", "page:contas:view"])` e `require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"])`.

### 4.9 Validação de Autorização Residual de Contexto de Consultor (`consultor.py`)
- **Problema**: Em `_resolve_empresa_contexto`, caso um consultor já tivesse `consultor.empresa_id` gravado no banco, o sistema retornava a empresa diretamente sem validar `tem_acesso(db, consultor.id, empresa_id)`. Se o acesso do consultor tivesse sido revogado em `ConsultorEmpresa`, ele mantinha acesso à empresa revogada.
- **Solução**: Validação mandatória de `_is_super_consultor(consultor) or tem_acesso(db, int(consultor.id), empresa_id)` antes de aceitar o `empresa_id` armazenado no perfil do consultor.

### 4.10 Ordem de Cascata e Integridade Referencial na Limpeza de Demonstrações (`demo_cleanup_service.py`)
- **Problema**: A rotina excluía `integracoes_bancarias` antes de `mapeamentos_categoria`, violando chaves estrangeiras ou gerando registros órfãos. Além disso, `plano_contas` com hierarquia pai-filho (`conta_pai_id`) podia falhar na deleção.
- **Solução**: Inversão da ordem de deleção (`mapeamentos_categoria` antes de `integracoes_bancarias`) e nulificação prévia de auto-referência (`UPDATE plano_contas SET conta_pai_id = NULL WHERE empresa_id = :id`).

---

## 🧪 5. Validação Automatizada de Segurança
- Novo arquivo de testes adicionado: [`tests/test_security_multitenancy_rbac.py`](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/tests/test_security_multitenancy_rbac.py).
- Backend: **78 testes passando (100% de sucesso)**.
- Frontend: **7 arquivos de teste, 25 testes passando (100% de sucesso)**.


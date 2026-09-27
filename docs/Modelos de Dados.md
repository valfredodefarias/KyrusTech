[🗺️ Visão Geral](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Visao%20Geral.md) / [🚀 Fluxo de Desenvolvimento](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Loops%20e%20Validacoes.md)
***

# 📊 Modelos de Dados do Kyrus ERP (Catálogo Completo - 48 Entidades)

**Padrão Nível Google / Enterprise**  
**Última Atualização**: 26 de Setembro de 2026  
**ORM**: SQLModel / SQLAlchemy 2.0 (PostgreSQL 17)  
**Registro Alembic**: Mapeamento unificado via `app.models` em `alembic/env.py`.

---

## 🏛️ 1. Governança, Multitenancy & RBAC

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `Empresa` | `empresas` | Entidade raiz do tenant. `razao_social`, `cnpj`, `data_bloqueio_periodo` (trava contábil), status. | 1:N com todos os módulos de negócio |
| `Usuario` | `usuarios` | Operadores e administradores. `email`, `hashed_password` (bcrypt), `role`, `empresa_id` default, `ativo`. | 1:N com perfis e lançamentos |
| `ConsultorEmpresa` | `consultores_empresas` | Mapeamento N:M para consultores/contadores gerenciarem múltiplos tenants via header `X-Company-ID`. | N:M entre `Usuario` e `Empresa` |
| `AccessPermission` | `access_permissions` | Catálogo de permissões granulares do sistema (`financeiro:ler`, `pdv:cancelar_venda`, `*`). | N:M com perfis de acesso |
| `AccessProfile` | `access_profiles` | Perfis corporativos (Administrador, Gerente, Operador PDV, Auditor, Consultor). | 1:N com associações de usuário |
| `AccessProfilePermission` | `access_profile_permissions` | Tabela intermediária de permissões associadas a cada perfil. | N:M `AccessProfile` <-> `AccessPermission` |
| `UserCompanyProfile` | `user_company_profiles` | Vínculo dinâmico que atribui um perfil específico a um usuário dentro de uma empresa. | N:M `Usuario` <-> `Empresa` <-> `AccessProfile` |
| `UserSession` | `user_sessions` | Rastreamento de sessões ativas, tokens JWT, IP de origem, dispositivo e revogação. | N:1 com `Usuario` |
| `UserInvite` | `user_invites` | Convites seguros para novos membros por e-mail com token e expiração. | N:1 com `Empresa` |
| `PasswordResetCode` | `password_reset_codes` | Códigos de recuperação de senha com limite temporal e expiração após uso. | N:1 com `Usuario` |
| `UsuarioContaAcesso` | `usuario_contas_acesso` | Restrição de visualização e movimentação a contas bancárias específicas por operador. | N:1 `Usuario`, N:1 `Conta` |

---

## 💰 2. Financeiro, Contábil & Orçamento

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `Lancamento` | `lancamentos` | Tabela central (399k+ registros). Contas a pagar/receber, `valor_previsto`, `valor_pago`, `data_vencimento`, `data_pagamento`, `previsto`. | N:1 `Empresa`, `PlanoContas`, `Conta`, `Entidade`, `Cartao`, `CentroCusto` |
| `PlanoContas` | `plano_contas` | Árvore hierárquica do plano de contas (DRE/DFC). `codigo` estruturado (ex: `1.1.01`), `tipo` (RECEITA, DESPESA). | N:1 `Empresa`, Auto-relacionamento hierárquico |
| `PlanoContasTemplateConfig`| `plano_contas_templates` | Templates pré-definidos de planos de contas para ramos específicos de atividade. | Configuração global / importação |
| `Conta` | `contas` | Contas bancárias, caixas físicos e aplicações. `saldo`, `agencia`, `conta_numero`, `tipo_conta`. | N:1 `Empresa`, 1:N com `Lancamento` e `Baixa` |
| `Entidade` | `entidades` | Cadastro unificado de Clientes, Fornecedores e Colaboradores. `cpf_cnpj`, `nome`, `tipo`. | N:1 `Empresa`, 1:N com `Lancamento` |
| `CentroCusto` | `centros_custo` | Centros de custo para alocação gerencial de projetos e departamentos. | N:1 `Empresa` |
| `Orcamento` | `orcamentos` | Metas e limites de orçamento financeiro por conta do plano de contas e competência. | N:1 `Empresa`, N:1 `PlanoContas` |
| `AnexoLancamento` | `anexos_lancamento`| Comprovantes bancários e notas fiscais salvos com UUID e validação de magic bytes. | N:1 `Lancamento` |
| `Movimento` | `movimentos` | Snapshot consolidado de saldos e movimentações diárias para relatórios contábeis ultrarrápidos. | N:1 `Conta`, N:1 `Empresa` |
| `Baixa` | `baixas` | Registro de liquidação de títulos. `valor_pago`, `juros`, `multa`, `desconto`, `data_baixa`. | N:1 `Lancamento`, N:1 `Conta` |

---

## 💳 3. Cartões Corporativos & Conciliação Bancária

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `Cartao` | `cartoes` | Cartões corporativos de crédito/débito. `limite_total`, `dia_fechamento`, `dia_vencimento`. | N:1 `Empresa`, N:1 `Conta` |
| `LancamentoCartao` | `lancamentos_cartao`| Faturas e despesas de cartão com parcela, data de compra e conciliação. | N:1 `Cartao`, N:1 `Empresa` |
| `RegraCartao` | `regras_cartao` | Regras inteligentes de autoclassificação de lançamentos por descrição ou padrão regex. | N:1 `Cartao`, N:1 `PlanoContas` |
| `LoteCartao` | `lotes_cartao` | Lote de processamento em massa de extratos de faturas de cartão. | N:1 `Empresa` |
| `LoteCartaoItem` | `lotes_cartao_itens` | Transações individuais contidas dentro do lote de cartão para conciliação. | N:1 `LoteCartao` |
| `IntegracaoBancaria`| `integracoes_bancarias`| Credenciais e tokens de Open Finance / APIs bancárias (Pluggy, Asaas, etc). | N:1 `Empresa` |
| `MapeamentoCategoria`| `mapeamentos_categoria`| Dicionário de classificação automática de extrato bancário para Plano de Contas. | N:1 `Empresa`, N:1 `PlanoContas` |
| `BankPresetConfig` | `bank_preset_configs` | Configurações de layout de importação de extratos bancários (OFX, CSV, Excel). | Global / Empresa |
| `ImportJob` | `import_jobs` | Fila de processamento assíncrono de arquivos pesados com progresso percentual. | N:1 `Empresa`, N:1 `Usuario` |

---

## 📦 4. Estoque & Produtos

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `Produto` | `produtos` | Catálogo de itens. `codigo_barras`, `sku`, `preco_venda`, `custo_medio`, `estoque_atual`, `estoque_minimo`. | N:1 `Empresa` |
| `FornecedorProdutoEquivalencia` | `fornecedor_produto_equivalencias` | Mapeamento automático de códigos de produtos de notas fiscais de fornecedor para produtos internos. | N:1 `Produto`, N:1 `Entidade` |
| `MovimentacaoEstoque` | `movimentacoes_estoque` | Histórico auditado de entradas, saídas, ajustes de inventário e baixas de venda. | N:1 `Produto`, N:1 `Empresa` |

---

## 🛒 5. Ponto de Venda (PDV) & Delivery

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `PdvVenda` | `pdv_vendas` | Vendas de balcão e delivery. `valor_total`, `desconto`, `forma_pagamento`, `status`, `observacao` (JSON). | N:1 `Empresa`, N:1 `Usuario` (Vendedor) |
| `PdvVendaItem` | `pdv_venda_itens` | Itens comercializados na venda com quantidade, preço unitário e alíquotas. | N:1 `PdvVenda`, N:1 `Produto` |
| `PdvMovimentacao` | `pdv_movimentacoes` | Controle de abertura, fechamento de caixa, sangrias de segurança e suprimentos. | N:1 `Empresa`, N:1 `Usuario` |
| `PdvIfoodLancamento`| `pdv_ifood_lancamentos`| Integração com iFood, vinculação de pedidos externos e conciliação de taxas de repasse. | N:1 `Empresa`, N:1 `PdvVenda` |

---

## 🎯 6. Comissões & Metas Comerciais

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `RegraComissao` | `regras_comissao` | Regras percentuais ou fixas de comissão por vendedor, faixa de faturamento ou produto. | N:1 `Empresa` |
| `MetaVendedor` | `metas_vendedores` | Metas financeiras de vendas mensais por operador para cálculo de premiação. | N:1 `Empresa`, N:1 `Usuario` |

---

## 🔍 7. Auditoria, Governança & Dashboard

| Modelo | Tabela | Descrição & Campos Críticos | Relacionamentos Principais |
| :--- | :--- | :--- | :--- |
| `AuditLog` | `audit_logs` | Trilha de auditoria imutável (tabela afetada, ID, ação INSERT/UPDATE/DELETE, diff JSON antes/depois). | N:1 `Empresa`, N:1 `Usuario` |
| `AuditMixin` | N/A (Mixin) | Mixin de persistência automática de `criado_em`, `atualizado_em` e `criado_por_id`. | Herdado por modelos corporativos |
| `IdempotencyLog` | `idempotency_logs` | Hash SHA-256 de requisições de pagamento e transações críticas para prevenção de duplicidade. | N:1 `Empresa` |
| `AlertaAnomalia` | `alertas_anomalias` | Detecção automatizada de discrepâncias financeiras, desvios de média e riscos de fraude. | N:1 `Empresa` |
| `RegraSilenciamentoAuditor` | `regras_silenciamento_auditor` | Regras configuráveis para silenciar alertas específicos e evitar falsos positivos. | N:1 `Empresa` |
| `TodoItem` | `todos` | Gestão de tarefas operacionais e pendências colaborativas da equipe. | N:1 `Empresa`, N:1 `Usuario` |
| `DashboardViewConfig`| `dashboard_view_configs` | Configuração persistida de cards visíveis, ordem de widgets e filtros por usuário. | N:1 `Empresa`, N:1 `Usuario` |
| `AnuncioLogin` / `NoticiaLogin` / `FonteNoticiaLogin` | Diversas | Informes de release, comunicados da diretoria e feed de notícias na tela de autenticação. | Global |


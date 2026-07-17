# Auditoria de Segurança: Vulnerabilidades Críticas de Controle de Acesso no Módulo PDV

Esta auditoria detalha falhas graves de autorização e controle de acesso (Bypass de Permissão) identificadas no arquivo de endpoints do PDV ([pdv.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/pdv.py)) e como elas serão corrigidas para garantir a integridade dos dados e prevenir fraudes operacionais.

---

## 🛑 Vulnerabilidades Críticas Identificadas

Embora as permissões do módulo PDV estejam cadastradas no banco (`access_seed_service.py`) e restritas no frontend (`App.tsx`), o backend falha ao validar essas regras nos endpoints. Qualquer usuário logado e ativo de uma empresa pode fazer requisições HTTP diretas e burlar as restrições:

### 1. Bypass de Cancelamento de Venda (`PATCH /vendas/{venda_id}/status`)
- **A Brecha**: O endpoint que altera o status da venda para `CANCELADO` ou `DEVOLVIDO` não verifica a permissão `PDV_CANCELAR_VENDA`.
- **O Impacto**: Qualquer operador de caixa comum pode cancelar vendas de qualquer valor no sistema (zerando o fluxo de caixa respectivo) para camuflar desvios de mercadoria ou dinheiro, sem precisar de autorização de gerente.
- **A Correção**: Validar as permissões efetivas do usuário antes de aceitar a transição de status para `CANCELADO` ou `DEVOLVIDO`:
  ```python
  permissions = get_effective_permission_codes(db, user_id=int(current_user.id), empresa_id=empresa_id)
  if "*" not in permissions and "PDV_CANCELAR_VENDA" not in permissions:
      raise HTTPException(status_code=403, detail="Você não tem permissão para cancelar ou devolver vendas.")
  ```

### 2. Bypass de Edição de Venda de Outros Operadores (`PUT /vendas/{venda_id}`)
- **A Brecha**: O endpoint de edição de venda não valida se a venda pertence ao operador logado ou se ele possui privilégios de gerente (`PDV_VER_TODAS_VENDAS`).
- **O Impacto**: Um operador pode editar as parcelas ou o vendedor de vendas de outros colegas de trabalho, distorcendo relatórios de comissão ou cometer fraudes.
- **A Correção**: Implementar validação para garantir que o usuário só edite suas próprias vendas, a menos que tenha permissão para ver todas:
  ```python
  permissions = get_effective_permission_codes(db, user_id=int(current_user.id), empresa_id=empresa_id)
  pode_ver_todas = "*" in permissions or "PDV_VER_TODAS_VENDAS" in permissions
  if not pode_ver_todas and venda_in.vendedor_id != current_user.id:
      raise HTTPException(status_code=403, detail="Você não tem permissão para editar vendas de outros vendedores.")
  ```

### 3. Bypass de Sangria de Caixa (`POST /sangrias`)
- **A Brecha**: A rota de criação de sangria/retirada de dinheiro (`criar_sangria_pdv`) é exposta a qualquer operador de caixa, sem validar a permissão `PDV_REALIZAR_SANGRIA`.
- **O Impacto**: Qualquer operador pode lançar retiradas e sangrias no sistema para maquiar balanços sem que o perfil dele tenha direitos para tal operação.
- **A Correção**: Exigir a permissão `PDV_REALIZAR_SANGRIA` antes de criar o lançamento financeiro de saída:
  ```python
  permissions = get_effective_permission_codes(db, user_id=int(current_user.id), empresa_id=empresa_id)
  if "*" not in permissions and "PDV_REALIZAR_SANGRIA" not in permissions:
      raise HTTPException(status_code=403, detail="Você não tem permissão para realizar sangria de caixa.")
  ```

### 4. Bypass de Configurações Financeiras do PDV (`PUT /config`)
- **A Brecha**: A rota de atualização de configurações do PDV (`atualizar_config_pdv`) altera as contas bancárias padrão do caixa e as formas de pagamento válidas, mas não exige cargo de gerente.
- **O Impacto**: Um operador mal-intencionado pode alterar a conta de destino das transações (redirecionando fundos) ou desativar o controle de estoque nas configurações.
- **A Correção**: Exigir o privilégio de configurações da empresa (`page:configuracoes:view`):
  ```python
  permissions = get_effective_permission_codes(db, user_id=int(current_user.id), empresa_id=empresa_id)
  if "*" not in permissions and "page:configuracoes:view" not in permissions:
      raise HTTPException(status_code=403, detail="Você não tem permissão para alterar as configurações do PDV.")
  ```

---

## 🛡️ Diagnóstico de Outros Recursos de Segurança

- **Multitenancy (Isolamento Multiempresa)**: O resolvedor `get_empresa_id_from_user` no arquivo `deps.py` está **extremamente seguro**. Ele valida se o cabeçalho `X-Company-ID` de fato pertence às empresas autorizadas do usuário (via perfis ou consultorias). Se for enviado um ID de outra empresa, o resolvedor desconsidera e cai para a empresa oficial do usuário cadastrada no banco.
- **Validação de Assinatura de Arquivos (Uploads)**: O utilitário `upload_security.py` implementa verificação robusta de Magic Bytes (cabeçalho de arquivo). Isso previne injeção de scripts (XSS/HTML) disfarçados de imagem/PDF.
- **Validação de Token JWT**: A expiração do token (`exp`) e assinatura são validadas de forma automática e segura pela biblioteca `jose` em `deps.py`.

---

## 📋 Plano de Correção e Mitigação

Essas 4 correções do PDV foram integradas ao nosso [docs/implementation_plan.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/implementation_plan.md) (Seção **1.E** do backend). A implementação é simples, limpa e não quebra nenhuma funcionalidade legítima do frontend.

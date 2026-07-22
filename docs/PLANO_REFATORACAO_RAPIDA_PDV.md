[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# ⚡ Plano de Ação para Refatoração Rápida e Segura do PDV

Este plano de ação foi desenhado para realizar a migração estrutural dos cartões e recebíveis para a tabela `pdv_movimentacoes` com o **menor esforço de desenvolvimento possível**, evitando alterações complexas no frontend e prevenindo quebras no sistema de produção.

---

## 🎯 Estratégia de Otimização (Como fazer rápido?)

A chave para uma refatoração rápida é **preservar o contrato da API**. Se o formato do JSON de resposta do novo endpoint `/pdv/recebiveis` for idêntico ao antigo, **não precisaremos reescrever a interface do frontend**, economizando dias de desenvolvimento e testes de UI.

A migração será dividida em **3 Fases Incrementais**:

---

## 📅 Fase 1: Redirecionamento da Leitura (Leitura Limpa)
*Prazo estimado: 2 a 3 horas*

Nesta fase, mudamos a origem de dados do calendário da conciliadora para a tabela correta. O sistema de gravação continua escrevendo duplicado nas duas tabelas temporariamente, mas a tela já passa a ler da tabela limpa.

### Passo 1.1: Criar a Migração do Banco de Dados (Alembic)
*   **O que fazer**: Alterar a tabela `lote_cartao_itens` para substituir a chave estrangeira `lancamento_id` por `pdv_movimentacao_id`.
*   **Comando**:
    ```bash
    # Gerar a migração
    docker exec -it kyrustech_backend alembic revision -m "alter_lote_itens_to_pdv_mov"
    ```
*   **Conteúdo da Migração**:
    ```python
    def upgrade():
        # Adicionar coluna pdv_movimentacao_id na tabela lote_cartao_itens
        op.add_column('lote_cartao_itens', sa.Column('pdv_movimentacao_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_lote_cartao_itens_pdv_mov', 'lote_cartao_itens', 'pdv_movimentacoes', ['pdv_movimentacao_id'], ['id'])
        # Remover a chave antiga de lancamento_id
        op.drop_constraint('lote_cartao_itens_lancamento_id_fkey', 'lote_cartao_itens', type_='foreignkey')
        op.drop_column('lote_cartao_itens', 'lancamento_id')
    ```

### Passo 1.2: Reescrever o Endpoint `/pdv/recebiveis`
*   **O que fazer**: Mudar a consulta SQL de `Lancamento` para `PdvMovimentacao`.
*   **Preservação do Contrato**: Garantir que o retorno JSON mantenha o mesmo dicionário de campos:
    ```json
    {
      "id": pdv_movimentacao.id, // ID da movimentação agora
      "venda_id_uuid": pdv_movimentacao.venda_id,
      "rv": pdv_movimentacao.rv,
      "data_venda": pdv_movimentacao.data,
      "data_vencimento": pdv_movimentacao.data, // ou data_venda + prazo adquirente
      "descricao": pdv_movimentacao.descricao,
      "tipo_pagamento": pdv_movimentacao.forma_pagamento,
      "bandeira": pdv_movimentacao.bandeira,
      "valor_bruto": pdv_movimentacao.valor,
      "valor_taxa": valor_taxa_calculado,
      "valor_liquido": valor_liquido_calculado,
      "status": pdv_movimentacao.conciliado ? "PAGO" : "A RECEBER"
    }
    ```

---

## 📅 Fase 2: Redirecionamento da Escrita e Conciliação (Escrita Limpa)
*Prazo estimado: 3 a 4 horas*

Nesta fase, paramos de sujar a tabela `lancamentos` com cartões novos e atualizamos os serviços de registro e liquidação.

### Passo 2.1: Alterar `pdv_service.py` (Registro de Vendas)
*   **O que fazer**: 
    - Na função de registrar venda, remover o bloco que gera objetos `Lancamento` com `origem = 'PDV'` para pagamentos em cartão de crédito, débito e Pix.
    - Manter a geração de `Lancamento` **apenas** para pagamentos em `dinheiro` (que afetam o saldo da tesouraria imediatamente).

### Passo 2.2: Atualizar Serviço de Conciliação em Lote
*   **O que fazer**:
    - Ajustar o endpoint `/pdv/conciliacao/lotes` para receber IDs de `pdv_movimentacoes`.
    - O serviço agora irá criar o `LoteCartao`, criar as linhas em `LoteCartaoItens` apontando para as movimentações de cartão, e dar o update nelas para `conciliado = True`.
    - O valor total do lote de cartões cria um **único** lançamento de `RECEITA` consolidado na tabela `lancamentos` (o depósito real do banco), associado ao `lotes_cartao.lancamento_deposito_id`.

---

## 📅 Fase 3: Higienização e DRE (Fase Final)
*Prazo estimado: 2 horas*

Nesta fase final, limpamos o lixo histórico e garantimos que a DRE mostre dados consistentes.

### Passo 3.1: Script de Higienização de Dados Relacionais
*   **O que fazer**: Criar um script SQL administrativo para apagar todos os lançamentos históricos redundantes:
    ```sql
    -- Remove lançamentos espelho duplicados
    DELETE FROM lancamentos 
    WHERE origem = 'PDV' 
      AND observacao LIKE '%"tipo_pagamento": "cartao_%';
    ```

### Passo 3.2: Ajuste e Simplificação da DRE
*   **O que fazer**:
    - No backend/frontend da DRE, remover completamente os filtros de desduplicação complexos.
    - A DRE passará a ler apenas as receitas reais da tabela `lancamentos` (onde agora só existirão depósitos consolidados de lotes de cartão e vendas em dinheiro real).

---

## 📝 Resumo do Esforço de Desenvolvimento

| Camada | Complexidade | Escopo de Edição |
| :--- | :--- | :--- |
| **Banco de Dados** | Baixa | 1 arquivo de migração Alembic |
| **Backend Services** | Média | Ajustes em `pdv_service.py` e endpoints de `pdv.py` |
| **Frontend UI** | Mínima | Troca de rota no PUT de edição manual em `ConciliacaoCartoes.tsx` |
| **DRE** | Baixa | Remoção de filtros duplicados no frontend |

Seguindo este plano estruturado, conseguimos realizar toda a transição em **menos de 1 dia de trabalho**, deixando o sistema infinitamente mais robusto e performático.

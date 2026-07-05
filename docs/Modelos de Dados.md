# 📊 Modelos de Dados do Kyrus ERP

Este documento detalha os principais modelos e relacionamentos do banco de dados do Kyrus ERP.

---

## 📈 1. Lançamento Financeiro (`Lancamento`)
O coração do financeiro. Representa receitas e despesas previstas ou realizadas.
*   **Campos Críticos**:
    *   `valor_previsto` e `valor_pago`: Valores monetários decimais.
    *   `data_vencimento` (indexada) e `data_pagamento` (requer atenção na indexação).
    *   `previsto`: Booleano indicando se é apenas uma previsão ou transação real.
*   **Chaves Estrangeiras**:
    *   `empresa_id` -> `Empresa` (Obrigatório)
    *   `plano_contas_id` -> `PlanoContas`
    *   `conta_id` -> `Conta`
    *   `entidade_id` -> `Entidade` (Cliente/Fornecedor)
    *   `cartao_id` -> `Cartao` (Opcional)

---

## 💳 2. Cartões de Crédito (`Cartao`)
Representa os cartões corporativos utilizados para despesas.
*   **Campos**:
    *   `nome_cartao`: Identificação do cartão.
    *   `limite_total`: Limite de crédito disponível.
    *   `dia_fechamento` e `dia_vencimento`: Determinam o cálculo automático das parcelas na fatura.
*   **Relacionamento**: Um cartão é associado a uma `Conta` de pagamento padrão.

---

## 🏦 3. Contas Bancárias (`Conta`)
Contas correntes ou caixas físicos da empresa.
*   **Campos**:
    *   `agencia`, `conta_numero`, `conta_digito`.
    *   `saldo`: Saldo atual consolidado.

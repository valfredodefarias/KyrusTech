# Relatório de Auditoria e Reconciliação Bancária - Conta Stone (FastEscova-PA)

- **Empresa:** FastEscova Ananindeua Centro (`empresa_id = 67`)
- **Conta:** Stone Instituição de Pagamento S.A. (`conta_id = 399`)
- **Período Auditado:** `01/09/2026 a 23/09/2026`
- **Data da Auditoria:** 24/09/2026
- **Responsável Técnico:** Antigravity AI Pair Programmer

---

## 1. Contexto e Resumo Executivo

Após o ajuste de saldo realizado em 23/09/2026, onde a conta Stone ficou perfeitamente conciliada em **R$ 46,56** (saldo correspondente ao encerramento do dia 22/09/2026), foi identificada uma divergência relevante no dia 24/09/2026:

| Indicador | Valor (R$) | Observação |
| :--- | :---: | :--- |
| **Saldo Final no Extrato Stone (em 23/09)** | **R$ 1.508,46** | Documento oficial da Stone (Pág. 1) |
| **Saldo Consolidado no ERP Kyrus** | **R$ 604,66** | Posição após os lançamentos de 24/09 |
| **Diferença (ERP vs Extrato)** | **- R$ 903,80** | O ERP está exatamente R$ 903,80 abaixo do banco |

---

## 2. Investigação Forense entre Backups

Para identificar a causa exata, foi realizada a comparação cruzada de dados (**diff forense**) entre:
1. **Backup Pré-Ajuste:** `backup_pre_correcao_categorias_20260923_121528.dump` (capturado em 23/09/2026 às 12:15).
2. **Backup Atual:** `backup_producao_20260924_2030.dump` (capturado em 24/09/2026 às 20:30).

### O que mudou no banco entre 23/09 e 24/09 na conta Stone:
- **Total Despesas Pagas:** `R$ 1.542.014,87` (permaneceu **rigorosamente idêntico** centavo por centavo).
- **Total Receitas Pagas:**
  - Em 23/09: `R$ 1.541.693,99`
  - Em 24/09: `R$ 1.542.252,09`
  - Aumento registrado: `+ R$ 558,10` (quando deveria ter aumentado `+ R$ 1.461,90`).

### A Causa Raiz Identificada:
No dia 24/09/2026, às **12:14:43**, a usuária **Cassia** (`updated_by_id = 120`) foi alimentar no sistema as 3 vendas que caíram na Stone em 23/09/2026:
- Mastercard Crédito: `R$ 653,04`
- Visa Crédito: `R$ 577,70`
- Maestro Débito: `R$ 231,16`

**O Erro Operacional:**
1. Para o *Mastercard* e *Visa*, ela criou normalmente dois novos lançamentos:
   - `ID 1129087` (R$ 653,04) criado às 12:15:08.
   - `ID 1129088` (R$ 577,70) criado às 12:15:39.
2. Porém, para o *Maestro Débito* (R$ 231,16), **ela abriu e editou um lançamento antigo que já existia no banco** (`ID 1127110`):
   - **Como o `ID 1127110` estava no backup de ontem (23/09):**  
     - Data Pagamento: `01/09/2026`  
     - Valor Pago: **`R$ 903,80`**  
     - Descrição: `MAESTRO DÉBITO`  
     - Observação: `Importado da linha 14098`
   - **Como o `ID 1127110` ficou após a edição de hoje (24/09 às 12:14:43):**  
     - Data Pagamento: `23/09/2026`  
     - Valor Pago: **`R$ 231,16`**  
     - `updated_by_id`: `120 (Cassia)`

### Impacto Matemático:
Ao substituir a venda de **R$ 903,80** do dia 01/09 por **R$ 231,16**:
1. A receita real de **R$ 903,80** de 01/09 desapareceu do ERP.
2. Em vez de somar R$ 1.461,90, o sistema somou apenas `1.461,90 - 903,80 = R$ 558,10`.
3. O saldo final ficou em `R$ 46,56 + R$ 558,10 = R$ 604,66`.
4. A diferença exata entre o extrato e o ERP é:  
   $$\text{Extrato (R\$ 1.508,46)} - \text{ERP (R\$ 604,66)} = \mathbf{R\$\ 903,80}$$

---

## 3. Auditoria de Entradas e Saídas do Mês (Setembro/2026)

Foi verificado se cada saída no extrato corresponde a uma saída no ERP, e se cada entrada corresponde a uma entrada:

1. **Total de Transações no Extrato (01/09 a 23/09):** 294 movimentações.
2. **Classificação das Naturezas:**
   - **100% das Entradas** do extrato estão classificadas como **RECEITA** no ERP.
   - **100% das Saídas** do extrato estão classificadas como **DESPESA** no ERP.
   - Nenhuma transação teve seu tipo invertido (não há entrada como despesa nem saída como receita).
3. **Agrupamentos Operacionais Realizados pela Equipe:**
   - **Empréstimos Stone:** No extrato ocorrem múltiplos débitos pequenos por dia (ex: 13,13 + 26,21 + 29,44 + 7,41). No ERP a equipe lançou o valor total diário consolidado (ex: R$ 76,19). A soma bate exatamente.
   - **Transferência Itaú/Stone (02/09):** No extrato caíram duas entradas (R$ 7.000,00 e R$ 1.500,00). No ERP foi lançado um único registro consolidado de R$ 8.500,00 (`ID 1127155 - ENTRE CONTAS`).
   - **Bonificações em Cartão (17/09):** No extrato constam entradas de 160 + 70 + 100 + 90 + 120 + 100 (= R$ 640,00). No ERP foi lançado R$ 640,00 consolidado (`ID 1127961`).
4. **Batimento Diário (08/09 a 23/09):**  
   Todos os dias entre 08/09 e 23/09 batem centavo por centavo no fechamento líquido, confirmando que a rotina operacional está consistente.

---

## 4. Plano de Ação para Conciliação Perfeita

Para reestabelecer o saldo exato de **R$ 1.508,46** e restaurar o lançamento histórico sobrescrito:

1. **Reverter o Lançamento ID 1127110 para o estado original:**
   ```sql
   UPDATE lancamentos
   SET valor_pago = 903.80,
       valor_previsto = 903.80,
       data_vencimento = '2026-09-01',
       data_pagamento = '2026-09-01',
       data_competencia = '2026-09-01',
       updated_at = NOW()
   WHERE id = 1127110 AND empresa_id = 67;
   ```

2. **Inserir o Lançamento de Receita do dia 23/09/2026 que faltava:**
   ```sql
   INSERT INTO lancamentos (
       empresa_id, conta_id, plano_contas_id, entidade_id, centro_custo_id,
       descricao, tipo, status, origem, previsto, ipp, conciliado,
       valor_previsto, valor_pago, valor_juros, valor_desconto, valor_multa,
       data_vencimento, data_pagamento, data_competencia, competencia,
       observacao, is_deleted, created_at, updated_at
   ) VALUES (
       67, 399, 9288, 46831, 146,
       'MAESTRO DÉBITO', 'RECEITA', 'PAGO', 'MANUAL', true, false, false,
       231.16, 231.16, 0.00, 0.00, 0.00,
       '2026-09-23', '2026-09-23', '2026-09-23', '09-2026',
       'Venda Maestro Débito 23/09/2026 (Regularização de conciliação)', false, NOW(), NOW()
   );
   ```

### Resultado Pós-Ajuste:
- Venda de 01/09/2026 restaurada: `+ R$ 903,80`
- Venda de 23/09/2026 registrada: `+ R$ 231,16`
- **Saldo Atual no ERP:** `R$ 604,66 + R$ 903,80 =` **`R$ 1.508,46`** (Conciliado 100% com o Extrato Stone).

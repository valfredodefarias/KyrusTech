[🗺️ Visão Geral]([[Visao Geral]]) / [🚀 Fluxo de Desenvolvimento]([[Loops e Validacoes]])
***

# 🩹 Plano de Refatoração e Erros Estruturais do PDV e Conciliadora

Este documento detalha os erros de arquitetura, as causas raiz dos bugs recentes na Conciliadora de Cartões e na DRE, as diretrizes de **O que não fazer de jeito nenhum** no desenvolvimento do Kyrus ERP, e o plano de ação para a refatoração definitiva utilizando as tabelas nativas de PDV (`pdv_vendas` e `pdv_movimentacoes`) já existentes no banco de dados.

---

## 🪳 1. Erros Estruturais e Bugs Diagnosticados

### A. Duplicação de Conceitos no Banco de Dados
*   **Problema**: O sistema possui tabelas específicas para vendas e pagamentos do PDV (`pdv_vendas` e `pdv_movimentacoes`), porém, para fazer as vendas aparecerem no fluxo de caixa geral, o sistema duplicava essas informações criando registros espelhos na tabela `lancamentos` com `origem = 'PDV'`.
*   **Consequência**: Inflação massiva do banco de dados (ex: a Pizza Fábio Umarizal acumulou sozinha mais de **66.000 lançamentos** de cartão), gerando lentidão crônica em todas as consultas financeiras e na geração do Boletim Diário e DRE.

### B. Uso Abusivo de Metadados em Strings JSON (`observacao`)
*   **Problema**: Em vez de adicionar colunas relacionais na tabela `lancamentos` para gerenciar os detalhes de cartão de crédito (como bandeira, modalidade, taxas e número de parcelas), o desenvolvedor anterior armazenou essas informações estruturadas em strings JSON dentro da coluna genérica `observacao`.
*   **Consequência**: 
    - O backend era forçado a fazer filtros de texto pesados e ineficientes no SQL (como `observacao.ilike('%"cartao_%')`), que ignoram os índices B-Tree normais e forçam varreduras sequenciais completas em disco (*Sequential Scans*).
    - O código dependia de parsing repetitivo (`JSON.parse` no frontend e `json.loads` no backend) dentro de loops gigantescos, gerando alto consumo de CPU e vazamento de memória por exceções de parse em observações de texto plano.

### C. O Bug de Truncamento por Limite Fixo no Calendário
*   **Problema**: O endpoint `/pdv/recebiveis` possuía um limite fixo no SQL de `.limit(2000)` ordenado por vencimento decrescente.
*   **Causa Raiz**: Quando reativamos as 25.000 linhas da planilha antiga da Pizza Fábio, as 2000 linhas de limite do backend foram totalmente preenchidas pelos lançamentos restaurados do passado e do presente, empurrando as previsões e lançamentos futuros para fora da query. Isso fez com que o calendário no frontend ficasse completamente em branco para datas futuras.
*   **Solução Imediata**: Alterar o frontend para forçar a API a filtrar pelo mês específico exibido no calendário, garantindo que a amostragem fique sempre abaixo de 2000 linhas.

### D. O Bug de Ocultação de Lançamentos Agrupados (`grouped_card_launch`)
*   **Problema**: Ao agrupar as previsões futuras de cartão em lotes diários por adquirente (para bater com o extrato), o sistema gerava lançamentos com a propriedade `"grouped_card_launch": true` na observação. Como esse JSON não possuía a chave `"tipo_pagamento": "cartao_..."`, o filtro antigo do backend `/recebiveis` ignorava e ocultava esses registros do calendário.
*   **Solução Imediata**: Ajustado o SQL do backend para filtrar por ambos os padrões de observação e injetar dinamicamente o `tipo_pagamento` correto na serialização para o frontend.

### E. Mascaramento de Dados Duplicados na DRE (`Dre.tsx`)
*   **Problema**: Devido a duplicidades históricas causadas por importações de planilhas de depósitos categorizadas incorretamente na conta de receita (`01.01.02`), a DRE mostrava faturamento duplicado para a Pizza Fábio antes de Julho de 2026. A solução anterior foi "mascarar" o erro no frontend criando um filtro na DRE que sumia com os lançamentos de `PDV` ou `WEB` dependendo do regime de caixa/competência.
*   **Consequência**: Quando o mês de Julho de 2026 chegou, o filtro continuou ocultando as vendas reais do PDV na DRE. Além disso, essa regra afetava todas as outras empresas do ERP, distorcendo relatórios de terceiros.

---

## 🚫 2. O QUE NÃO FAZER DE JEITO NENHUM

1.  **Nunca Mascarar Erros de Dados no Frontend**: Se uma DRE ou relatório exibe valores incorretos devido a lançamentos duplicados no banco de dados, **corrija os dados no banco de dados** (via scripts de migração de dados / SQL). Nunca escreva condicionais, limites de data hardcodados (`data < '2026-07-01'`) ou filtros por empresa específica no código compartilhado do frontend.
2.  **Nunca Armazenar Atributos de Busca em Colunas de Texto JSON**: Informações críticas que serão usadas em ordenação, agrupamento ou filtragem (como bandeira, modalidade, status de conciliação e data de vencimento) **devem ser colunas estruturadas no banco de dados**, com tipos de dados corretos e indexadas. A coluna `observacao` deve servir estritamente para anotações textuais do usuário.
3.  **Nunca Fazer Queries de Alta Escala Sem Filtros Temporais Limítrofes**: Nunca permita que uma rota de dashboard ou calendário consulte dados históricos do banco sem passar parâmetros de início e fim (`start_date` e `end_date`), sob risco de estourar a memória do servidor ou truncar informações essenciais por paginação.
4.  **Nunca Executar Operações Bloqueantes no Thread Principal (Event Loop)**: Evite loops extensos de manipulação de arrays ou parsing complexo de JSONs no backend do FastAPI sem delegar para workers apropriados, para não congelar o servidor web.

---

## 🗺️ 3. Plano de Refatoração Definitiva (Caminho Correto)

A refatoração consistirá em remover a duplicação financeira e fazer com que a Conciliadora de Cartões leia diretamente as tabelas nativas de PDV (`pdv_movimentacoes` e `pdv_vendas`), deixando a tabela `lancamentos` apenas para movimentações bancárias reais.

### Etapa 1: Limpeza do Código do Frontend (`Dre.tsx`)
*   **Ação**: Remover os filtros de desduplicação e regras hardcodadas de data (`isBeforeJuly`, `preferredWebCodes`).
*   **Objetivo**: Fazer com que a DRE reflita 100% o que está gravado no banco de dados, de forma transparente.

### Etapa 2: Correção de Categoria Histórica (Database Script)
*   **Ação**: Rodar um script SQL administrativo para re-categorizar os lançamentos antigos de planilha da Pizza Fábio.
*   **Objetivo**: Mover os lançamentos de planilhas antigas que eram depósitos de cartão de contas de Receita (`01.01.02`) para a conta de Ativo/Recebíveis Compensados, eliminando a duplicidade histórica na DRE de forma limpa direto na fonte de dados.

### Etapa 3: Migração da Conciliadora para a Tabela `pdv_movimentacoes`
*   **Ação**: 
    1. Alterar o endpoint `/pdv/recebiveis` no backend para fazer a busca na tabela `pdv_movimentacoes` em vez de `lancamentos`.
    2. Utilizar as colunas nativas (`bandeira`, `forma_pagamento`, `valor`, `data`) diretamente na query SQL.
    3. Atualizar o fluxo de Conciliação em Lote: a conciliação passará a atualizar a coluna `conciliado = true` e o vínculo com a tabela `lotes_cartao`.
*   **Objetivo**: Fim do parsing de JSON no backend/frontend e aumento de 10x na velocidade de carregamento do calendário.

### Etapa 4: Depreciação e Exclusão de Lançamentos Espelho (`origem = 'PDV'`)
*   **Ação**:
    1. Desativar no código do PDV (`pdv_service.py`) a criação automática de `Lancamento` espelho para cada venda de cartão.
    2. Criar e rodar um script para deletar do banco todos os lançamentos com `origem = 'PDV'` que eram apenas espelhos de cartão (mantendo apenas as vendas reais em dinheiro, que movimentam o caixa imediatamente).
*   **Objetivo**: Reduzir o tamanho da tabela `lancamentos` em até 70%, otimizando o backup, restore e a performance global do ERP.

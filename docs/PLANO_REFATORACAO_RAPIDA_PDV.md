[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER

Este documento serve como plano de ação e manual de instruções detalhado para que um **Agente de IA Coding Assistant** execute de forma autônoma, rápida e segura a refatoração do módulo de conciliação de cartões e recebíveis no Kyrus ERP.

---

## 🛑 1. DIRETRIZES E POLÍTICAS CRÍTICAS PARA A IA

Durante a execução da refatoração, a IA **DEVE** seguir rigorosamente as seguintes políticas:

1.  **Política de Preservação do Contrato da API (Backward Compatibility)**:
    - O JSON retornado pelo endpoint `/pdv/recebiveis` **NÃO PODE** sofrer alterações nos nomes ou tipos das chaves. A estrutura de dados recebida pelo frontend deve continuar idêntica para evitar reescrever telas ou causar quebras visuais.
2.  **Política de Não-Hardcode**:
    - É **estritamente proibido** injetar condições com datas fixas (ex: `'2026-07-01'`), IDs de empresas específicas (ex: `35`) ou códigos específicos de plano de contas (ex: `'01.01.02'`) no código da aplicação. As regras devem ser dinâmicas e baseadas em metadados/configurações do banco de dados.
3.  **Política de Integridade Transacional (Atomicidade)**:
    - Toda operação de escrita no banco de dados deve ocorrer dentro de um bloco de transação seguro do SQLAlchemy (`db.commit()`), tratando exceções com rollback (`db.rollback()`) para evitar estados de dados inconsistentes ou órfãos no banco de dados.
4.  **Política de Proteção contra Travamento de Event Loop (CPU-bound)**:
    - Queries que envolvem loops massivos de processamento ou conversão de dados devem ser otimizadas no nível de banco de dados (SQL) e executadas fora da thread assíncrona principal se ultrapassarem 100ms de execução.

---

## 🗺️ 2. MAPEAMENTO DE ARQUIVOS ALVO

A IA deverá atuar exclusivamente sobre os seguintes arquivos:

1.  **Backend (Lógica e Banco)**:
    - [pdv.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/pdv.py): Onde residem as rotas `/pdv/recebiveis` e `/pdv/conciliacao/lotes`.
    - [pdv_service.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/services/pdv_service.py): Onde reside a lógica de inserção e atualização de vendas do PDV.
    - [lancamento.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/models/lancamento.py) (ou modelos equivalentes de PDV): Para ajustar chaves estrangeiras.
2.  **Frontend (Telas)**:
    - [ConciliacaoCartoes.tsx](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes.tsx): Ajustar requisições de edição de vencimento/taxa e cancelamento.
    - [Dre.tsx](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Dre.tsx): Limpar os filtros de desduplicação do passado.

---

## 🛠️ 3. PASSO A PASSO TÉCNICO DA EXECUÇÃO

### 📅 FASE 1: Alteração do Schema de Banco (Alembic)
A tabela `lote_cartao_itens` deve parar de apontar para a tabela `lancamentos` e passar a apontar para `pdv_movimentacoes`.

1.  **Gerar a Migração**:
    ```bash
    docker exec -it kyrustech_backend alembic revision -m "alter_lote_itens_to_pdv_mov"
    ```
2.  **Escrever o Script de Upgrade**:
    ```python
    def upgrade():
        # 1. Adicionar coluna pdv_movimentacao_id em lote_cartao_itens
        op.add_column('lote_cartao_itens', sa.Column('pdv_movimentacao_id', sa.Integer(), nullable=True))
        
        # 2. Criar Chave Estrangeira apontando para pdv_movimentacoes(id)
        op.create_foreign_key(
            'fk_lote_cartao_itens_pdv_mov', 
            'lote_cartao_itens', 'pdv_movimentacoes', 
            ['pdv_movimentacao_id'], ['id'], 
            ondelete='CASCADE'
        )
        
        # 3. Remover restrição antiga
        op.drop_constraint('lote_cartao_itens_lancamento_id_fkey', 'lote_cartao_itens', type_='foreignkey')
        op.drop_column('lote_cartao_itens', 'lancamento_id')
        
        # 4. Criar index de performance na tabela pdv_movimentacoes
        op.create_index('ix_pdv_movimentacoes_conciliado_data', 'pdv_movimentacoes', ['empresa_id', 'conciliado', 'data'])
    ```

---

### 📅 FASE 2: Reescrita da Consulta `/pdv/recebiveis`
Alterar a query de leitura em `app/api/v1/endpoints/pdv.py` para consultar `pdv_movimentacoes`.

1.  **Substituir a Query SQL**:
    ```python
    # Antigo: select(Lancamento)
    # Novo:
    query = (
        select(PdvMovimentacao, PdvVenda)
        .join(PdvVenda, PdvVenda.id == PdvMovimentacao.venda_id, isouter=True)
        .where(
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False,
            PdvMovimentacao.forma_pagamento.ilike('cartao_%')
        )
    )
    ```
2.  **Converter/Mapear as Propriedades para Manter o Contrato**:
    Mapeie os atributos de `PdvMovimentacao` de volta nas chaves esperadas pelo TypeScript do frontend:
    ```python
    recebiveis.append({
        "id": mov.id,  # ID da movimentação
        "venda_id_uuid": mov.venda_id,
        "rv": mov.import_hash or f"RV-{mov.id}",
        "data_venda": mov.data,
        "data_vencimento": calcular_data_vencimento(mov.data, mov.forma_pagamento), # D+1 Débito, D+30 Crédito
        "descricao": mov.descricao,
        "tipo_pagamento": mov.forma_pagamento,
        "bandeira": (mov.bandeira or "OUTROS").upper(),
        "numero_parcela": 1,
        "total_parcelas": mov.parcelas or 1,
        "valor_bruto": mov.valor,
        "valor_taxa": calcular_taxa_proporcional(mov.valor, mov.bandeira, mov.forma_pagamento),
        "valor_liquido": mov.valor - valor_taxa,
        "status": "PAGO" if mov.conciliado else "A RECEBER",
        "vendedor": "Sem vendedor", 
        "cliente": "Cliente Consumidor",
        "itens": []
    })
    ```

---

### 📅 FASE 3: Desativação dos Lançamentos Duplicados na Escrita
Ajustar `app/services/pdv_service.py` para parar de encher a tabela `lancamentos` com registros espelhos.

1.  **Localizar a criação de Lançamentos na persistência da venda**:
    Identifique onde a função `registrar_venda_pdv` (ou método similar) itera sobre as formas de pagamento para criar registros `Lancamento`.
2.  **Bloquear a geração de Lançamentos de cartão**:
    ```python
    # Apenas crie Lançamento no financeiro se forma_pagamento for dinheiro
    if forma_pagamento.lower() == "dinheiro":
        criar_lancamento_financeiro_imediato(db, venda, valor)
    else:
        # NÃO crie Lancamento. Salve apenas em pdv_movimentacoes!
        # pdv_movimentacoes é a única fonte da verdade para cartões.
        pass
    ```

---

### 📅 FASE 4: Refatoração da Conciliação em Lote (`pdv.py`)
Ajustar a rota `/pdv/conciliacao/lotes` para liquidar movimentações.

1.  **Modificar Parâmetro de Entrada**:
    Receber `pdv_movimentacao_ids: list[int]` no payload.
2.  **Lógica Interna**:
    - Buscar as movimentações na tabela `pdv_movimentacoes` filtrando pelos IDs recebidos.
    - Criar o registro unificado `LoteCartao` representando o depósito bancário consolidado.
    - Criar um **único** `Lancamento` do tipo `RECEITA` (origem `CONCILIACAO_CARTAO`) com o valor líquido total do lote (este é o registro real que entra no saldo do banco).
    - Vincular o `Lancamento.id` recém-criado em `lotes_cartao.lancamento_deposito_id`.
    - Iterar nas movimentações, atualizando `conciliado = True`.
    - Criar os itens correspondentes na tabela `lote_cartao_itens`.

---

### 📅 FASE 5: Higienização do Banco de Dados
Remover os 66 mil registros espelhos antigos que ficaram "órfãos" na tabela `lancamentos`.

1.  **Rodar a limpeza**:
    ```sql
    DELETE FROM lancamentos 
    WHERE origem = 'PDV' 
      AND (observacao LIKE '%"tipo_pagamento": "cartao_%' OR observacao LIKE '%"grouped_card_launch": true%');
    ```

---

### 📅 FASE 6: Correção Limpa da DRE (`Dre.tsx`)
1.  **Limpar o Frontend**:
    - Remova as arrays `preferredWebCodes` e todo o bloco de desduplicação do `useMemo` de lançamentos.
    - Faça com que a DRE utilize apenas a tabela `lancamentos` pura de forma transparente.
2.  **Limpar os dados duplicados históricos**:
    - Escreva um script SQL específico para a Pizza Fábio que encontre os lançamentos antigos de planilhas de depósitos e altere o `plano_contas_id` deles para a conta de compensação do Ativo Circulante em vez de Receita (`01`), eliminando a duplicidade histórica de forma correta e definitiva no banco.

---

## 🧪 4. MANUAL DE VERIFICAÇÃO E TESTES PARA A IA

Para validar que o seu código está correto antes de submeter os commits, a IA **DEVE** rodar os seguintes testes:

1.  **Verificar API `/recebiveis`**:
    - Criar e rodar o script `scripts/test_direct_api_call.py` (ou equivalente de teste) e conferir se ele retorna a lista desmembrada perfeitamente com todas as chaves JSON esperadas.
2.  **Verificar DRE**:
    - Fazer chamadas simuladas de cálculo de DRE e conferir se os saldos fecham perfeitamente e se não ocorrem exceções na renderização.
3.  **Auditar Locks e Performance**:
    - Executar `EXPLAIN ANALYZE` na query do endpoint `/recebiveis` no PostgreSQL local para garantir que ela utilize o índice criado (`ix_pdv_movimentacoes_conciliado_data`) e que o custo de execução da query seja menor que 10ms.

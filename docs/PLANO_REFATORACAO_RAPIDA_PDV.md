[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER (ULTIMATE EDITION)

Este documento é a especificação arquitetural final para a refatoração do módulo de conciliação de cartões e recebíveis do Kyrus ERP. Ele detalha a normalização completa do banco de dados, o fluxo de persistência de vendas e o tratamento estruturado de parcelas.

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
    - [pdv.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/api/v1/endpoints/pdv.py): Onde residem as rotas `/pdv/recebiveis`, `/pdv/conciliacao/lotes` e onde criaremos a nova rota `/pdv/movimentacoes/{id}`.
    - [pdv_service.py](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/app/services/pdv_service.py): Onde reside a lógica de inserção e atualização de vendas do PDV.
2.  **Frontend (Telas)**:
    - [ConciliacaoCartoes.tsx](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes.tsx): Ajustar requisições de edição de vencimento/taxa e cancelamento.
    - [Dre.tsx](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Dre.tsx): Limpar os filtros de desduplicação do passado.

---

## 🛠️ 3. A GRANDE SACADA ARQUITETURAL: EXPLOSÃO NO BANCO VS. EXPLOSÃO NA API

> [!IMPORTANT]
> **O Desafio do Parcelamento**: Se uma venda é feita em Crédito 3x, as parcelas serão pagas pelo banco com 30, 60 e 90 dias de prazo. Cada uma dessas parcelas é conciliada (paga) de forma independente.
>
> Se mantivermos apenas 1 registro na tabela `pdv_movimentacoes` para a venda toda, **não conseguiremos controlar quais parcelas já foram pagas e quais estão em aberto**, pois só haveria uma única coluna `conciliado` para as 3 parcelas.
>
> **A Solução Normalizada**: Adicionar a coluna `numero_parcela` na tabela `pdv_movimentacoes` e **explodir as parcelas em registros individuais diretamente no momento da venda (insert)**. 
>
> Exemplo de venda de R$ 300,00 em 3x no dia 01/10/2026:
> *   **Registro 1**: `valor = 100.00`, `parcelas = 3`, `numero_parcela = 1`, `data = 31/10/2026` (D+30), `conciliado = false`
> *   **Registro 2**: `valor = 100.00`, `parcelas = 3`, `numero_parcela = 2`, `data = 30/11/2026` (D+60), `conciliado = false`
> *   **Registro 3**: `valor = 100.00`, `parcelas = 3`, `numero_parcela = 3`, `data = 30/12/2026` (D+90), `conciliado = false`

Isso torna as consultas do calendário do financeiro extremamente limpas, indexadas por data e imunes a bugs de cálculo em tempo de execução.

---

## 🛠️ 4. PASSO A PASSO TÉCNICO DA EXECUÇÃO

### 📅 FASE 1: Alteração do Schema de Banco (Alembic)
A tabela `lote_cartao_itens` deve parar de apontar para a tabela `lancamentos` e passar a apontar para `pdv_movimentacoes`. Além disso, a tabela `pdv_movimentacoes` ganha a coluna `numero_parcela`.

1.  **Gerar a Migração**:
    ```bash
    docker exec -it kyrustech_backend alembic revision -m "normalize_pdv_movimentacoes"
    ```
2.  **Escrever o Script de Upgrade**:
    ```python
    def upgrade():
        # 1. Adicionar colunas em pdv_movimentacoes
        op.add_column('pdv_movimentacoes', sa.Column('numero_parcela', sa.Integer(), nullable=False, server_default='1'))
        
        # 2. Adicionar pdv_movimentacao_id em lote_cartao_itens
        op.add_column('lote_cartao_itens', sa.Column('pdv_movimentacao_id', sa.Integer(), nullable=True))
        
        # 3. Criar Chave Estrangeira em lote_cartao_itens
        op.create_foreign_key(
            'fk_lote_cartao_itens_pdv_mov', 
            'lote_cartao_itens', 'pdv_movimentacoes', 
            ['pdv_movimentacao_id'], ['id'], 
            ondelete='CASCADE'
        )
        
        # 4. Remover restrição antiga
        op.drop_constraint('lote_cartao_itens_lancamento_id_fkey', 'lote_cartao_itens', type_='foreignkey')
        op.drop_column('lote_cartao_itens', 'lancamento_id')
        
        # 5. Criar index de performance na tabela pdv_movimentacoes
        op.create_index('ix_pdv_movimentacoes_conciliado_fast', 'pdv_movimentacoes', ['empresa_id', 'conciliado', 'data'])
    ```

---

### 📅 FASE 2: Data Migration do Histórico de Conciliações
A IA executora deve mapear as conciliações históricas de lote usando o `venda_id` e a correspondência de parcelas:

```python
# Dentro do upgrade() do Alembic, execute esta query de update antes de deletar a coluna antiga:
connection = op.get_bind()
mapping_query = sa.text("""
    SELECT 
        lci.id as item_id,
        pm.id as mov_id
    FROM lote_cartao_itens lci
    JOIN lancamentos l ON l.id = lci.lancamento_id
    JOIN pdv_movimentacoes pm ON (
        pm.venda_id = (l.observacao::json->>'venda_id_uuid')
        AND pm.numero_parcela = COALESCE((l.observacao::json->>'numero_parcela')::int, 1)
    )
    WHERE l.origem = 'PDV' 
      AND pm.forma_pagamento ILIKE 'cartao_%'
""")

results = connection.execute(mapping_query).fetchall()
for row in results:
    connection.execute(
        sa.text("UPDATE lote_cartao_itens SET pdv_movimentacao_id = :mov_id WHERE id = :item_id"),
        {"mov_id": row.mov_id, "item_id": row.item_id}
    )
```

---

### 📅 FASE 3: Alteração da Escrita de Vendas (`pdv_service.py`)
Modificar a persistência do PDV para salvar os lançamentos de cartões já explodidos na tabela de movimentações de acordo com o número de parcelas da venda.

```python
from dateutil.relativedelta import relativedelta

def registrar_venda_pdv(db: Session, dados_venda: VendaCreateSchema, empresa_id: int):
    # 1. Inserir venda em pdv_vendas
    venda_db = PdvVenda(...)
    db.add(venda_db)
    db.flush()
    
    # 2. Inserir pagamentos em pdv_movimentacoes explodindo parcelas
    for pag in dados_venda.pagamentos:
        if pag.forma_pagamento.lower() == "dinheiro":
            # Dinheiro físico gera lançamento imediato no caixa geral
            lancamento_caixa = Lancamento(
                empresa_id=empresa_id,
                tipo="RECEITA",
                valor_previsto=pag.valor,
                valor_pago=pag.valor,
                data_vencimento=venda_db.data_venda,
                data_pagamento=venda_db.data_venda,
                status="PAGO",
                origem="PDV_CAIXA",
                descricao="Venda PDV - Dinheiro Físico"
            )
            db.add(lancamento_caixa)
        elif "cartao" in pag.forma_pagamento.lower():
            total_parcelas = pag.parcelas or 1
            valor_parcela = round(pag.valor / total_parcelas, 2)
            
            # Gerar um registro de movimentação para cada parcela
            for i in range(1, total_parcelas + 1):
                # Calcular data estimada do recebimento da parcela (D+30 para crédito)
                dias_prazo = 1 if "debito" in pag.forma_pagamento.lower() else 30 * i
                data_recebimento = venda_db.data_venda + relativedelta(days=dias_prazo)
                
                mov = PdvMovimentacao(
                    empresa_id=empresa_id,
                    tipo="RECEITA",
                    descricao=f"Parcela {i}/{total_parcelas} Venda PDV {venda_db.id}",
                    valor=valor_parcela,
                    forma_pagamento=pag.forma_pagamento,
                    bandeira=pag.bandeira,
                    parcelas=total_parcelas,
                    numero_parcela=i,
                    data=data_recebimento, # A data no banco passa a ser a data de vencimento da parcela
                    venda_id=venda_db.id,
                    conciliado=False
                )
                db.add(mov)
                
    db.commit()
```

---

### 📅 FASE 4: Reescrita da Consulta `/pdv/recebiveis` (Query Direta Otimizada)
Como os dados já estão explodidos no banco de dados, o endpoint do backend `/pdv/recebiveis` passa a ser extremamente simples e rápido, sem necessidade de laços de repetição de data em Python:

```python
@router.get("/recebiveis")
def listar_recebiveis_cartao(
    start_date: date = Query(...),
    end_date: date = Query(...),
    empresa_id: int = Query(...),
    db: Session = Depends(get_db)
):
    # 1. Carregar mapa de taxas de cartão em memória
    regras = db.execute(
        select(RegraCartao).where(RegraCartao.empresa_id == empresa_id, RegraCartao.is_deleted == False)
    ).scalars().all()
    
    taxa_map = {}
    for r in regras:
        bandeira_key = r.bandeira.upper() if r.bandeira else "OUTROS"
        modalidade_key = r.tipo_pagamento.upper() if r.tipo_pagamento else "CREDITO"
        taxa_map[(bandeira_key, modalidade_key)] = float(r.taxa)

    # 2. Consultar movimentações de cartão diretamente no range de datas
    stmt = (
        select(PdvMovimentacao, PdvVenda.id.label("venda_uuid"), PdvVenda.data_venda)
        .join(PdvVenda, PdvVenda.id == PdvMovimentacao.venda_id, isouter=True)
        .where(
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False,
            PdvMovimentacao.forma_pagamento.ilike('cartao_%'),
            PdvMovimentacao.data >= start_date,
            PdvMovimentacao.data <= end_date
        )
    )
    
    resultados = db.execute(stmt).all()
    recebiveis = []
    
    for row in resultados:
        mov, venda_uuid, data_venda = row
        bandeira_limpa = (mov.bandeira or "OUTROS").upper()
        modalidade = "DEBITO" if "debito" in mov.forma_pagamento.lower() else "CREDITO"
        
        # Obter taxa cadastrada ou fallback padrão
        taxa_percentual = taxa_map.get((bandeira_limpa, modalidade))
        if taxa_percentual is None:
            taxa_percentual = 2.0 if modalidade == "DEBITO" else 3.5
            
        valor_bruto = float(mov.valor)
        valor_taxa = round(valor_bruto * (taxa_percentual / 100.0), 2)
        valor_liquido = round(valor_bruto - valor_taxa, 2)
        
        recebiveis.append({
            "id": mov.id,  # ID direto do banco, sem IDs compostos fictícios!
            "venda_id_uuid": venda_uuid or mov.venda_id,
            "rv": mov.import_hash or f"RV-{mov.id}",
            "data_venda": data_venda or mov.data,
            "data_vencimento": mov.data,
            "descricao": mov.descricao,
            "tipo_pagamento": mov.forma_pagamento,
            "bandeira": bandeira_limpa,
            "numero_parcela": mov.numero_parcela,
            "total_parcelas": mov.parcelas or 1,
            "valor_bruto": valor_bruto,
            "valor_taxa": valor_taxa,
            "valor_liquido": valor_liquido,
            "status": "PAGO" if mov.conciliado else "A RECEBER",
            "vendedor": "N/A",
            "cliente": "Consumidor Final"
        })
        
    return recebiveis
```

---

## 🧪 5. MANUAL DE VERIFICAÇÃO E TESTES PARA A IA

A IA executora **DEVE** validar a integridade da refatoração rodando os seguintes comandos e scripts de validação:

### A. Teste de Consistência das APIs
Execute o script de teste para garantir que o formato JSON está intacto e que a explosão de parcelas funciona:
```bash
docker exec -t -w /app -e PYTHONPATH=. kyrustech_backend python scripts/test_direct_api_call.py
```

### B. Auditoria do Banco (SQL de Validação)
Rode a seguinte query no Postgres local para certificar que nenhum lote de cartões ficou órfão e que as movimentações estão associadas de forma correta:
```sql
SELECT 
    lc.id as lote_id, 
    lc.valor_bruto, 
    count(lci.id) as total_itens,
    sum(pm.valor) as soma_movimentacoes
FROM lotes_cartao lc
JOIN lote_cartao_itens lci ON lci.lote_cartao_id = lc.id
LEFT JOIN pdv_movimentacoes pm ON pm.id = lci.pdv_movimentacao_id
GROUP BY lc.id;
```
*(A coluna `valor_bruto` deve bater exatamente com `soma_movimentacoes` em todos os registros).*

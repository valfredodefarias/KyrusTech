[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER (MAXIMUM DETAIL)

Este documento é a especificação técnica de nível de arquiteto sênior para guiar a refatoração do módulo de conciliação de cartões e recebíveis no Kyrus ERP. Ele cobre todas as regras de negócio, tratamentos de parcelamento e contratos de API de forma exaustiva.

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
        # 1. Adicionar pdv_movimentacao_id como anulável temporariamente
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
        op.create_index('ix_pdv_movimentacoes_conciliado_fast', 'pdv_movimentacoes', ['empresa_id', 'conciliado', 'data'])

    def downgrade():
        op.add_column('lote_cartao_itens', sa.Column('lancamento_id', sa.Integer(), nullable=True))
        op.create_foreign_key(
            'lote_cartao_itens_lancamento_id_fkey', 
            'lote_cartao_itens', 'lancamentos', 
            ['lancamento_id'], ['id']
        )
        op.drop_constraint('fk_lote_cartao_itens_pdv_mov', 'lote_cartao_itens', type_='foreignkey')
        op.drop_column('lote_cartao_itens', 'pdv_movimentacao_id')
        op.drop_index('ix_pdv_movimentacoes_conciliado_fast')
    ```

---

### 📅 FASE 2: Data Migration do Histórico de Conciliações
Para garantir que as conciliações antigas não sejam perdidas, execute a migração de dados acoplando as movimentações aos lotes existentes:

```python
# Dentro do upgrade() do Alembic, execute esta query de update antes de dropar a coluna:
connection = op.get_bind()
mapping_query = sa.text("""
    SELECT 
        lci.id as item_id,
        pm.id as mov_id
    FROM lote_cartao_itens lci
    JOIN lancamentos l ON l.id = lci.lancamento_id
    JOIN pdv_movimentacoes pm ON (
        pm.venda_id = (l.observacao::json->>'venda_id_uuid')
        OR (pm.data = l.data_vencimento AND pm.valor = l.valor_previsto)
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

### 📅 FASE 3: Reescrita da Consulta `/pdv/recebiveis` e Explosão de Parcelas
> [!IMPORTANT]
> **Explosão de Parcelas**: A tabela `pdv_movimentacoes` armazena vendas parceladas como uma única linha (ex: `valor = 300`, `parcelas = 3`). No entanto, o calendário financeiro exige que essa linha seja **desmembrada em 3 recebíveis separados** (1/3 de $100 no mês 1, 2/3 de $100 no mês 2, etc.). O backend deve explodir dinamicamente essas parcelas na resposta da API.

```python
from datetime import timedelta
from dateutil.relativedelta import relativedelta

def calcular_vencimento(data_base: date, modalidade: str, numero_parcela: int) -> date:
    if modalidade == "DEBITO":
        return data_base + timedelta(days=1)
    # Crédito: Parcela 1 vence em 30 dias, Parcela 2 em 60 dias, etc.
    return data_base + relativedelta(months=numero_parcela)

@router.get("/recebiveis")
def listar_recebiveis_cartao(
    start_date: date = Query(...),
    end_date: date = Query(...),
    empresa_id: int = Query(...),
    db: Session = Depends(get_db)
):
    # 1. Carregar regras de taxas da empresa
    regras = db.execute(
        select(RegraCartao).where(RegraCartao.empresa_id == empresa_id, RegraCartao.is_deleted == False)
    ).scalars().all()
    
    taxa_map = {}
    for r in regras:
        bandeira_key = r.bandeira.upper() if r.bandeira else "OUTROS"
        modalidade_key = r.tipo_pagamento.upper() if r.tipo_pagamento else "CREDITO"
        taxa_map[(bandeira_key, modalidade_key)] = float(r.taxa)

    # 2. Consultar movimentações de cartão
    stmt = (
        select(PdvMovimentacao, PdvVenda.id.label("venda_uuid"), PdvVenda.data_venda)
        .join(PdvVenda, PdvVenda.id == PdvMovimentacao.venda_id, isouter=True)
        .where(
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False,
            PdvMovimentacao.forma_pagamento.ilike('cartao_%'),
            PdvMovimentacao.data >= start_date - timedelta(days=365), # Busca histórica para capturar parcelas passadas que vencem neste período
            PdvMovimentacao.data <= end_date
        )
    )
    
    resultados = db.execute(stmt).all()
    recebiveis = []
    
    for row in resultados:
        mov, venda_uuid, data_venda = row
        bandeira_limpa = (mov.bandeira or "OUTROS").upper()
        modalidade = "DEBITO" if "debito" in mov.forma_pagamento.lower() else "CREDITO"
        
        # Buscar taxa cadastrada com fallback hierárquico
        taxa_percentual = taxa_map.get((bandeira_limpa, modalidade))
        if taxa_percentual is None:
            taxa_percentual = taxa_map.get(("OUTROS", modalidade)) or (2.0 if modalidade == "DEBITO" else 3.5)
            
        total_parcelas = mov.parcelas or 1
        valor_bruto_total = float(mov.valor)
        
        # EXPLODIR DINAMICAMENTE AS PARCELAS
        for i in range(1, total_parcelas + 1):
            data_vencimento_parcela = calcular_vencimento(mov.data, modalidade, i)
            
            # Filtrar se o vencimento desta parcela específica cai no range consultado
            if not (start_date <= data_vencimento_parcela <= end_date):
                continue
                
            valor_bruto_parcela = round(valor_bruto_total / total_parcelas, 2)
            valor_taxa_parcela = round(valor_bruto_parcela * (taxa_percentual / 100.0), 2)
            valor_liquido_parcela = round(valor_bruto_parcela - valor_taxa_parcela, 2)
            
            # Usar id composto id-parcela para chaves React no frontend
            recebiveis.append({
                "id": f"{mov.id}-{i}", # ID composto para evitar colisão no React
                "movimentacao_id": mov.id,
                "venda_id_uuid": venda_uuid or mov.venda_id,
                "rv": mov.import_hash or f"RV-{mov.id}-{i}",
                "data_venda": data_venda or mov.data,
                "data_vencimento": data_vencimento_parcela,
                "descricao": f"Parcela {i}/{total_parcelas} - {bandeira_limpa} {modalidade}",
                "tipo_pagamento": mov.forma_pagamento,
                "bandeira": bandeira_limpa,
                "numero_parcela": i,
                "total_parcelas": total_parcelas,
                "valor_bruto": valor_bruto_parcela,
                "valor_taxa": valor_taxa_parcela,
                "valor_liquido": valor_liquido_parcela,
                "status": "PAGO" if mov.conciliado else "A RECEBER",
                "vendedor": "N/A",
                "cliente": "Consumidor Final"
            })
            
    return recebiveis
```

---

### 📅 FASE 4: Criação do Endpoint de Edição de Vencimento
Como o frontend passará a editar `pdv_movimentacoes`, crie a seguinte rota de atualização em `pdv.py`:

```python
from pydantic import BaseModel

class MovimentacaoUpdate(BaseModel):
    data: Optional[date] = None
    valor: Optional[float] = None
    conciliado: Optional[bool] = None

@router.put("/movimentacoes/{id}")
def atualizar_movimentacao_pdv(id: int, payload: MovimentacaoUpdate, db: Session = Depends(get_db)):
    mov = db.get(PdvMovimentacao, id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
        
    if payload.data is not None:
        mov.data = payload.data
    if payload.valor is not None:
        mov.valor = payload.valor
    if payload.conciliado is not None:
        mov.conciliado = payload.conciliado
        
    db.commit()
    return {"message": "Movimentação atualizada com sucesso"}
```

---

### 📅 FASE 5: Ajuste na Conciliação de Lotes (`pdv.py`)
Alterar o fechamento de lotes para receber a estrutura correta.

```python
class ConciliarLoteSchema(BaseModel):
    empresa_id: int
    data_pagamento: date
    valor_bruto: float
    valor_taxa: float
    valor_liquido: float
    conta_destino_id: int
    movimentacao_ids: List[int] # Lista de ids de pdv_movimentacoes

@router.post("/conciliacao/lotes")
def conciliar_lote_cartao(payload: ConciliarLoteSchema, db: Session = Depends(get_db)):
    try:
        # 1. Criar o lançamento de depósito unificado em lancamentos (Dinheiro real compensado no banco)
        lancamento_deposito = Lancamento(
            empresa_id=payload.empresa_id,
            tipo="RECEITA",
            valor_previsto=payload.valor_bruto,
            valor_pago=payload.valor_liquido,
            data_vencimento=payload.data_pagamento,
            data_pagamento=payload.data_pagamento,
            status="PAGO",
            origem="CONCILIACAO_CARTAO",
            descricao="Depósito Lote Cartões Conciliado"
        )
        db.add(lancamento_deposito)
        db.flush() # Gerar ID do lançamento de depósito
        
        # 2. Criar o cabeçalho do lote em lotes_cartao
        lote = LoteCartao(
            empresa_id=payload.empresa_id,
            data_pagamento=payload.data_pagamento,
            valor_bruto=payload.valor_bruto,
            valor_taxa=payload.valor_taxa,
            valor_liquido=payload.valor_liquido,
            conta_destino_id=payload.conta_destino_id,
            lancamento_deposito_id=lancamento_deposito.id,
            status="CONCILIADO"
        )
        db.add(lote)
        db.flush() # Gerar ID do lote
        
        # 3. Vincular os itens e marcar como conciliado
        for mov_id in payload.movimentacao_ids:
            mov = db.get(PdvMovimentacao, mov_id)
            if mov:
                mov.conciliado = True
                
                # Criar item de junção
                item = LoteCartaoItem(
                    lote_cartao_id=lote.id,
                    pdv_movimentacao_id=mov.id,
                    valor_bruto=mov.valor,
                    valor_taxa=0.0, # Pode ser proporcional
                    valor_liquido=mov.valor
                )
                db.add(item)
                
        db.commit()
        return {"status": "success", "lote_id": lote.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
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

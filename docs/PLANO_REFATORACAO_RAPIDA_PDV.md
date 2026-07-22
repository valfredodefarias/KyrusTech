[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🩹 MANUAL DE ENGENHARIA DE REFATORAÇÃO DO PDV E FINANCEIRO (10x IMPROVED)

Este documento é o plano definitivo, exaustivo e de nível de produção para guiar a refatoração do módulo de conciliação de cartões e vendas do Kyrus ERP. Ele serve de especificação técnica absoluta para qualquer agente de IA ou desenvolvedor encarregado da execução.

---

## 🗺️ ÍNDICE
1. [Diretrizes de Segurança e Políticas de Proteção](#1-diretrizes-de-seguranca-e-politicas-de-protecao)
2. [Arquitetura dos Dados Históricos (Estratégia de Não-Perda de Conciliações)](#2-arquitetura-dos-dados-historicos-estrategia-de-nao-perda-de-concilicoes)
3. [Modelagem de Banco de Dados e Scripts de Migração (Alembic)](#3-modelagem-de-banco-de-dados-e-scripts-de-migracao-alembic)
4. [Reescrita das APIs do Backend e Cálculo Dinâmico de Taxas](#4-reescrita-das-apis-do-backend-e-calculo-dinamico-de-taxas)
5. [Refatoração dos Fluxos de Escrita e Serviços](#5-refatoracao-dos-fluxos-de-escrita-e-servicos)
6. [Ajustes Detalhados no Frontend (React/TypeScript)](#6-ajustes-detalhados-no-frontend-reacttypescript)
7. [Plano de Higienização de Dados (Pizza Fábio)](#7-plano-de-higienizacao-de-dados-pizza-fabio)
8. [Checklist de Verificação, Testes e Plano de Rollback](#8-checklist-de-verificacao-testes-e-plano-de-rollback)

---

## 1. DIRETRIZES DE SEGURANÇA E POLÍTICAS DE PROTEÇÃO

### A. Política de Rollback Síncrono Obrigatório
Nenhuma migração ou alteração de código de gravação pode ser implantada sem um script de rollback testado localmente. Em caso de qualquer erro de integridade referencial ou falha de query no ambiente de homologação, a reversão completa deve ser executada imediatamente.

### B. Isolamento de Tenant (Multi-empresa)
A tabela `pdv_movimentacoes` compartilha dados de todas as filiais e empresas. Qualquer query SQL executada pela API ou scripts de migração **DEVE** incluir a cláusula `empresa_id = :empresa_id` explicitamente nos filtros para evitar vazamento ou cruzamento de dados entre clientes distintos.

### C. Manutenção do Contrato de API do Frontend
O payload retornado pelo endpoint `/pdv/recebiveis` deve manter a compatibilidade estrutural exata com a interface TypeScript `RecebivelCartao` definida no frontend. As assinaturas e chaves de resposta devem permanecer idênticas.

---

## 2. ARQUITETURA DOS DADOS HISTÓRICOS (ESTRATÉGIA DE NÃO-PERDA DE CONCILIAÇÕES)

> [!IMPORTANT]
> **O maior risco desta migração é perder o histórico de conciliações já realizadas** na tabela `lote_cartao_itens`. Hoje, esses registros apontam para IDs da tabela `lancamentos`. Se simplesmente apagarmos essa coluna, perderemos quais cartões compunham os lotes passados.

Para evitar isso, a migração do Alembic deve executar um processo de **Data Migration** em 3 passos antes de remover as colunas antigas:

```
[Lote de Cartões] -> [Lote Cartão Itens (Aponta p/ Lançamento)]
                               | (Busca ID Venda UUID e Valor)
                               v
               [Acha pdv_movimentacoes Correspondente]
                               | (Grava novo ID da Movimentação)
                               v
[Lote de Cartões] -> [Lote Cartão Itens (Aponta p/ pdv_movimentacoes)]
```

---

## 3. MODELAGEM DE BANCO DE DADOS E SCRIPTS DE MIGRAÇÃO (ALEMBIC)

O script de migração do Alembic deve ser dividido em duas partes: **Schema Migration** e **Data Migration**.

### Script de Migração Completo (`alembic/versions/...py`):

```python
"""refactor card reconciliation tables

Revision ID: refactor_card_rec_001
Revises: previous_revision
Create Date: 2026-07-22

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # --- PARTE 1: SCHEMA UPGRADE (Novas colunas e tabelas) ---
    # 1. Adicionar pdv_movimentacao_id como anulável temporariamente
    op.add_column('lote_cartao_itens', sa.Column('pdv_movimentacao_id', sa.Integer(), nullable=True))
    
    # 2. Criar Chave Estrangeira em lote_cartao_itens
    op.create_foreign_key(
        'fk_lote_cartao_itens_pdv_mov', 
        'lote_cartao_itens', 'pdv_movimentacoes', 
        ['pdv_movimentacao_id'], ['id'], 
        ondelete='CASCADE'
    )
    
    # --- PARTE 2: DATA MIGRATION (Mapeamento de Histórico) ---
    connection = op.get_bind()
    
    # Query para buscar a correspondência entre Lançamento e PdvMovimentacao histórica
    # Usamos o valor bruto e o venda_id_uuid (que está no JSON de observação)
    # ou combinamos a data do lançamento com o valor
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
        
    # Marcar as movimentações migradas históricas como conciliadas
    connection.execute(sa.text("""
        UPDATE pdv_movimentacoes 
        SET conciliado = true 
        WHERE id IN (SELECT pdv_movimentacao_id FROM lote_cartao_itens WHERE pdv_movimentacao_id IS NOT NULL)
    """))

    # --- PARTE 3: SCHEMA CLEANUP (Remoção do lixo) ---
    # 1. Tornar a nova coluna NOT NULL após popular os dados históricos
    # (Apenas se todas forem mapeadas; caso contrário, manter nullable=True)
    
    # 2. Remover coluna antiga e FK
    op.drop_constraint('lote_cartao_itens_lancamento_id_fkey', 'lote_cartao_itens', type_='foreignkey')
    op.drop_column('lote_cartao_itens', 'lancamento_id')
    
    # 3. Criar índices de performance fundamentais
    op.create_index('ix_pdv_movimentacoes_conciliado_fast', 'pdv_movimentacoes', ['empresa_id', 'conciliado', 'data'])

def downgrade():
    # --- PARTE 4: DOWNGRADE SÁBIO ---
    op.add_column('lote_cartao_itens', sa.Column('lancamento_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'lote_cartao_itens_lancamento_id_fkey', 
        'lote_cartao_itens', 'lancamentos', 
        ['lancamento_id'], ['id']
    )
    
    # Data migration reversa se necessário usando vinculo do lote
    connection = op.get_bind()
    connection.execute(sa.text("""
        UPDATE lote_cartao_itens lci
        SET lancamento_id = (
            SELECT l.id 
            FROM lancamentos l
            JOIN pdv_movimentacoes pm ON pm.venda_id = (l.observacao::json->>'venda_id_uuid')
            WHERE pm.id = lci.pdv_movimentacao_id
            LIMIT 1
        )
        WHERE lci.pdv_movimentacao_id IS NOT NULL
    """))
    
    op.drop_constraint('fk_lote_cartao_itens_pdv_mov', 'lote_cartao_itens', type_='foreignkey')
    op.drop_column('lote_cartao_itens', 'pdv_movimentacao_id')
    op.drop_index('ix_pdv_movimentacoes_conciliado_fast')
```

---

## 4. REESCRITA DAS APIS DO BACKEND E CÁLCULO DINÂMICO DE TAXAS

Como a tabela `pdv_movimentacoes` não possui as colunas de `valor_liquido` e `valor_taxa`, essas informações devem ser calculadas de forma dinâmica no backend juntando com a tabela `regras_cartao` baseando-se na bandeira e modalidade (crédito/débito) do cartão.

### Código do Endpoint `/pdv/recebiveis` (`app/api/v1/endpoints/pdv.py`):

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, func
from datetime import date
from typing import List, Optional
from app.db.session import get_db
from app.models.pdv import PdvMovimentacao, PdvVenda
from app.models.regras import RegraCartao  # Tabela com as taxas acordadas de cada bandeira

router = APIRouter()

@router.get("/recebiveis")
def listar_recebiveis_cartao(
    start_date: date = Query(...),
    end_date: date = Query(...),
    empresa_id: int = Query(...),
    db: Session = Depends(get_db)
):
    # 1. Buscar todas as regras de taxa de cartão ativas da empresa para fazer lookup rápido em memória
    regras = db.execute(
        select(RegraCartao).where(RegraCartao.empresa_id == empresa_id, RegraCartao.is_deleted == False)
    ).scalars().all()
    
    # Montar mapa de taxas: {(bandeira, tipo): taxa_percentual}
    taxa_map = {}
    for r in regras:
        bandeira_key = r.bandeira.upper() if r.bandeira else "OUTROS"
        modalidade_key = r.tipo_pagamento.upper() if r.tipo_pagamento else "CREDITO"
        taxa_map[(bandeira_key, modalidade_key)] = float(r.taxa)

    # 2. Consultar as movimentações de cartão do período
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
        .order_by(PdvMovimentacao.data.asc())
    )
    
    resultados = db.execute(stmt).all()
    recebiveis = []
    
    for row in resultados:
        mov, venda_uuid, data_venda = row
        bandeira_limpa = (mov.bandeira or "OUTROS").upper()
        
        # Mapear forma de pagamento para tipo de regra
        modalidade = "DEBITO" if "debito" in mov.forma_pagamento.lower() else "CREDITO"
        
        # Obter taxa cadastrada ou usar fallback padrão (ex: 2.0% débito, 3.5% crédito)
        taxa_percentual = taxa_map.get((bandeira_limpa, modalidade))
        if taxa_percentual is None:
            taxa_percentual = 2.0 if modalidade == "DEBITO" else 3.5
            
        valor_bruto = float(mov.valor)
        valor_taxa = round(valor_bruto * (taxa_percentual / 100.0), 2)
        valor_liquido = round(valor_bruto - valor_taxa, 2)
        
        # Estimar data de vencimento baseada no prazo da adquirente (ex: D+1 débito, D+30 crédito)
        prazo_dias = 1 if modalidade == "DEBITO" else 30
        # Regras customizadas de antecipação podem ser injetadas aqui
        
        recebiveis.append({
            "id": mov.id,  # O ID agora é o da PdvMovimentacao
            "venda_id_uuid": venda_uuid or mov.venda_id,
            "rv": mov.import_hash or f"RV-{mov.id}",
            "data_venda": data_venda or mov.data,
            "data_vencimento": mov.data,  # A conciliadora exibe pela data prevista de depósito
            "descricao": mov.descricao or f"Recebível {bandeira_limpa} {modalidade}",
            "tipo_pagamento": mov.forma_pagamento,
            "bandeira": bandeira_limpa,
            "numero_parcela": 1,
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

## 5. REFATORAÇÃO DOS FLUXOS DE ESCRITA E SERVIÇOS

No arquivo `app/services/pdv_service.py`, na função responsável por salvar e processar a venda finalizada no terminal:

```python
# --- ANTES: Duplicava gerando lançamento ---
# for pag in venda.pagamentos:
#     if pag.tipo in ["cartao_credito", "cartao_debito"]:
#         criar_lancamento_card(pag)

# --- DEPOIS (REFATORADO): Bloqueia geração redundante ---
def registrar_venda_pdv(db: Session, dados_venda: VendaCreateSchema, empresa_id: int):
    # 1. Inserir cabeçalho da venda em pdv_vendas
    venda_db = PdvVenda(...)
    db.add(venda_db)
    db.flush()
    
    # 2. Inserir itens em pdv_venda_itens
    
    # 3. Inserir pagamentos em pdv_movimentacoes
    for pag in dados_venda.pagamentos:
        mov = PdvMovimentacao(
            empresa_id=empresa_id,
            tipo="RECEITA",
            descricao=f"Pagamento Venda PDV {venda_db.id}",
            valor=pag.valor,
            forma_pagamento=pag.forma_pagamento, # ex: 'cartao_credito'
            bandeira=pag.bandeira,
            parcelas=pag.parcelas,
            data=venda_db.data_venda,
            venda_id=venda_db.id,
            conciliado=False
        )
        db.add(mov)
        
        # REGRAS FINANCEIRAS GERAIS:
        # Se for DINHEIRO, gera lançamento financeiro de caixa na hora
        if pag.forma_pagamento.lower() == "dinheiro":
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
            
    db.commit()
```

---

## 6. AJUSTES DETALHADOS NO FRONTEND (REACT/TYPESCRIPT)

Como mantivemos a compatibilidade do payload da rota GET de recebíveis, a única alteração necessária no frontend reside nas ações onde o usuário edita manualmente os vencimentos ou as taxas dos cartões na conciliadora.

### No arquivo `kyrus-web/src/pages/ConciliacaoCartoes.tsx`:

#### A. Ação de Alteração Manual de Data/Valor
Quando o usuário altera as propriedades de um recebível pendente no calendário:

```typescript
// --- ANTES: Chamava rota de lançamentos ---
// await api.put(`/lancamentos/${item.id}`, { data_vencimento: novaData, valor_previsto: novoValor });

// --- DEPOIS (REFATORADO): Chama a nova rota de edição de movimentações de PDV ---
const handleSaveEditRecebivel = async (itemId: number, novaData: string, novoValor: number) => {
  try {
    setLoading(true);
    await api.put(`/pdv/movimentacoes/${itemId}`, {
      data: novaData,
      valor: novoValor
    });
    // Recarregar a agenda de cartões da tela
    await fetchAgenda();
    toast.success("Recebível atualizado com sucesso!");
  } catch (err) {
    toast.error("Erro ao atualizar o recebível.");
  } finally {
    setLoading(false);
  }
};
```

---

## 7. PLANO DE HIGIENIZAÇÃO DE DADOS (PIZZA FÁBIO)

Para eliminar definitivamente o duplicado histórico da DRE sem mascarar o código, rode a seguinte query administrativa no Postgres da produção:

```sql
-- 1. Mover lançamentos de planilhas de cartões da conta de receita (01) para a conta transitória de cartão do Ativo (1.1.02.01)
-- Isso evita que o faturamento apareça duplicado na DRE do passado, mantendo o saldo do banco correto.
UPDATE lancamentos l
SET plano_contas_id = (
    SELECT pc.id 
    FROM plano_contas pc 
    WHERE pc.codigo = '01.09.99' -- Ou conta transitória de ajuste de saldos
    LIMIT 1
)
WHERE l.empresa_id = 35 -- Pizza Fábio Umarizal
  AND l.origem = 'WEB'
  AND (l.observacao ILIKE '%importação financeiro%' OR l.observacao ILIKE '%importacao financeiro%')
  AND l.plano_contas_id IN (
      SELECT id FROM plano_contas WHERE codigo IN ('01.01.02', '01.01.03', '01.01.04')
  );

-- 2. Limpar os lançamentos redundantes criados pelo PDV no passado na tabela de lançamentos
DELETE FROM lancamentos 
WHERE empresa_id = 35 
  AND origem = 'PDV' 
  AND (observacao LIKE '%"tipo_pagamento": "cartao_%' OR observacao LIKE '%"grouped_card_launch": true%');
```

---

## 8. CHECKLIST DE VERIFICAÇÃO, TESTES E PLANO DE ROLLBACK

### A. Checklist de Testes do Desenvolvedor (IA Checklist)
*   `[ ]` **Testar Schema**: O script de migração do Alembic executa (`upgrade`) e reverte (`downgrade`) sem estourar restrições de FK?
*   `[ ]` **Validar DRE**: O relatório da DRE da Pizza Fábio para o mês de Julho/2026 bate exatamente com a soma das vendas reais fechadas no caixa?
*   `[ ]` **Verificar Conciliação**: Selecionar 5 recebíveis no calendário e conciliá-los contra um depósito do extrato bancário. Validar se o status de todos em `pdv_movimentacoes` vira `conciliado = True` e se o relacionamento de lotes é gravado corretamente.

### B. Procedimento de Rollback de Emergência
Se após o deploy em produção a tela de conciliação travar ou os saldos divergirem:

1.  **Reverter a migração de banco**:
    ```bash
    docker exec -it kyrustech_backend alembic downgrade -1
    ```
2.  **Reverter o código do backend/frontend**:
    ```bash
    git checkout HEAD~1 -- app/api/v1/endpoints/pdv.py app/services/pdv_service.py kyrus-web/src/pages/ConciliacaoCartoes.tsx
    ```
3.  **Reiniciar serviços**:
    ```bash
    docker compose restart kyrustech_backend kyrustech_frontend
    ```

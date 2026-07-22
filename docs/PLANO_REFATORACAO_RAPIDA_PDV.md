[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER (5-TABLE RECONCILIATION)

Este documento é a especificação técnica absoluta de engenharia para guiar a refatoração do módulo de conciliação de cartões e recebíveis no Kyrus ERP. Ele mapeia toda a arquitetura financeira de reconciliação bancária de ponta a ponta, conectando as tabelas de vendas do PDV, os recebíveis explodidos, os lotes de cartão, os lançamentos contábeis e as movimentações de extrato bancário (OFX) de forma 100% normalizada.

---

## 🗺️ ÍNDICE
1. [Diretrizes de Segurança e Políticas de Não-Quebra](#1-diretrizes-de-seguranca-e-politicas-de-nao-quebra)
2. [O Ecossistema Relacional de Conciliação (5 Tabelas)](#2-o-ecossistema-relacional-de-conciliacao-5-tabelas)
3. [A Separação de Realidades: Lançamentos vs. Movimentos (OFX)](#3-a-separacao-de-realidades-lancamentos-vs-movimentos-ofx)
4. [Análise de Bugs Críticos no Fluxo de Conciliação e Mitigações](#4-analise-de-bugs-criticos-no-fluxo-de-conciliacao-e-mitigacoes)
5. [Modelagem e Data Migration Histórico Otimizado (Alembic)](#5-modelagem-e-data-migration-historico-otimizado-alembic)
6. [Gravação de Vendas com Distribuição de Arredondamento e Cascading Soft-Delete](#6-gravacao-de-vendas-com-distribuicao-de-arredondamento-e-cascading-soft-delete)
7. [Reescrita das APIs de Recebíveis e Movimentações com JOIN de Vendas](#7-reescrita-das-apis-de-recebiveis-e-movimentacoes-com-join-de-vendas)
8. [Endpoints de Edição Segura e Estorno (Cancelamento)](#8-endpoints-de-edicao-segura-e-estorno-cancelamento)
9. [Checklist de Homologação e Script de Auditoria Pós-Migration](#9-checklist-de-homologacao-e-script-de-auditoria-pos-migration)

---

## 1. DIRETRIZES DE SEGURANÇA E POLÍTICAS DE NÃO-QUEBRA

Durante a execução da refatoração, a IA **DEVE** seguir rigorosamente as seguintes políticas:

1.  **Isolamento de Tenant (Multi-empresa)**: Toda consulta ou escrita SQL deve conter o filtro `empresa_id = :empresa_id`.
2.  **Preservação do Contrato da API**: O JSON de resposta do endpoint `/pdv/recebiveis` deve ter chaves com nomes e tipos idênticos para não quebrar a tipagem React/TS.
3.  **Proibição Absoluta de Modificação de Registros Conciliados**: Nenhuma API ou interface pode permitir a edição de data ou valor de movimentações cujo status de conciliação seja `conciliado = True`.
4.  **Preservação de Helpers de Payout e Regras**: Devemos obrigatoriamente utilizar os helpers `calcular_payout_date` e `shift_months` existentes em `pdv_service.py` para calcular as datas estimadas de recebimento, honrando as regras de taxas da tabela `regras_cartao`.

---

## 2. O ECOSSISTEMA RELACIONAL DE CONCILIAÇÃO (5 TABELAS)

Para evitar duplicidade e manter a consistência matemática dos saldos do ERP, o fluxo de conciliação utiliza 5 tabelas especializadas por domínio:

```
[pdv_movimentacoes] (Recebíveis de cartão explodidos por parcela)
        |
        | (muitos para um)
        v
  [lotes_cartao] (Agrupador diário por adquirente/bandeira)
        |
        | (um para um)
        v
  [lancamentos] (Receita consolidada de depósito no extrato do ERP)
        |
        | (um para muitos / muitos para um via Baixa)
        v
    [baixas] (Tabela de junção da conciliação bancária)
        ^
        | (muitos para um)
        |
  [movimentos] (Transações reais importadas do arquivo OFX do banco)
```

1.  **`pdv_movimentacoes`**: Contém o recebível individual de cada venda desmembrado por parcela.
2.  **`lotes_cartao`**: Agrupa as movimentações de cartão liquidadas no mesmo dia.
3.  **`lancamentos`**: O lançamento financeiro que representa a entrada de dinheiro real na conta bancária.
4.  **`movimentos`**: A transação física de crédito do extrato bancário importada via arquivo OFX.
5.  **`baixas`**: A tabela de reconciliação que vincula o lançamento de receita (`lancamento_id`) à transação física do extrato (`movimento_id`), marcando a conciliação como concluída.

---

## 3. A SEPARAÇÃO DE REALIDADES: LANÇAMENTOS VS. MOVIMENTOS (OFX)

*   **`movimentos` (Realidade Externa / Suporte de Leitura)**: É uma tabela de suporte e leitura. Ela funciona como um log fiel e imutável das movimentações físicas da conta bancária extraídas do arquivo OFX (valor, banco, data, FITID). Ela **não possui categoria contábil** e não sofre alterações manuais.
*   **`lancamentos` (Realidade Interna / Operacional)**: É a tabela de controle operacional do ERP. Possui categoria contábil, centro de custo, descrição amigável e é totalmente editável pelo usuário. É ela que calcula os relatórios contábeis e a DRE.

### O Fluxo Bidirecional de Usabilidade no Frontend e Backend:

```
[Tela de Extrato / OFX]               [Tela de Lançamentos Financeiros]
     |                                               |
     | (Usuário seleciona Movimento)                 | (Usuário marca Lançamento como pago)
     v                                               v
[Busca Lançamento Correspondente]          [Busca Movimento no Extrato]
     |                                               | (Mesmo valor, data e conta)
     | (Encontra e associa)                          | (Se achar, vincula)
     v                                               v
-----------------------> [Gera registro em BAIXAS] <-----------------------
                                     |
                                     v
                    [Lançamento vira PAGO no financeiro]
                    [Movimento do Extrato vira CONCILIADO]
```

---

## 4. ANÁLISE DE BUGS CRÍTICOS NO FLUXO DE CONCILIAÇÃO E MITIGAÇÕES

### Bug A: Inflação de Saldos Contábeis por Match N-para-1 (Divergência de Valores)
*   **O Cenário**: Um usuário faz a conciliação de uma transação de extrato bancário de R$ 1.000,00 (`movimentos`) vinculando-a a três contas a receber pendentes de R$ 300,00, R$ 500,00 e R$ 200,00 (`lancamentos`).
*   **O Erro**: Se o backend copiar cegamente o valor do movimento físico para a coluna `valor_pago` de cada lançamento, os três lançamentos assumirão o valor de R$ 1.000,00 cada. Isso inflacionará o saldo bancário contábil da empresa no ERP para R$ 3.000,00 em vez dos R$ 1.000,00 reais recebidos.
*   **Mitigação**: O `valor_pago` de cada `Lancamento` individual deve ser definido estritamente pelo valor da respectiva linha gerada na tabela de junção `baixas` (que grava a fatia alocada do rateio). O backend deve executar:
    ```python
    lancamento.valor_pago = db.execute(
        select(func.sum(Baixa.valor_pago)).where(Baixa.lancamento_id == lancamento.id, Baixa.is_deleted == False)
    ).scalar() or Decimal("0.00")
    ```

### Bug B: Falha no Auto-Match por Processamento Bancário Atrasado (Date Delay)
*   **O Cenário**: O usuário paga um boleto ou recebe um Pix de madrugada ou no final de semana (ex: Sexta-feira, 24/07). O banco processa e grava a data de liquidação física no extrato OFX apenas no próximo dia útil (Segunda-feira, 27/07).
*   **O Erro**: Uma query de auto-match que busque a correspondência exata de datas (`movimento.data == lancamento.data_pagamento`) falhará em 100% das transações de finais de semana e feriados.
*   **Mitigação**: O algoritmo de conciliação bancária do backend deve aplicar uma **tolerância temporal de +/- 3 dias** na comparação de datas para fins de cruzamento e sugestão de match:
    ```python
    where(
        Movimento.data >= lancamento.data_pagamento - timedelta(days=3),
        Movimento.data <= lancamento.data_pagamento + timedelta(days=3)
    )
    ```

### Bug C: Duplicidade Contábil por Duplo Match de Lançamento Reconciliado
*   **O Cenário**: Um lançamento de R$ 100,00 já foi associado a um movimento de extrato A. Posteriormente, o usuário tenta associar esse mesmo lançamento a um movimento de extrato B.
*   **O Erro**: O sistema gera a segunda baixa e acumula duplicidade de entrada no saldo de caixa.
*   **Mitigação**: Bloquear a criação de novas baixas se a soma das baixas ativas existentes para o lançamento já atingir o seu valor bruto total (`valor_previsto`), a menos que seja uma baixa de diferença de juros/multas devidamente identificada.

### Bug D: Estorno Incompleto de Baixas (Desconciliação Órfã)
*   **O Cenário**: O usuário desfaz uma conciliação contábil excluindo o registro correspondente da tabela `baixas`.
*   **O Erro**: O lançamento contábil continua marcado como `PAGO` e a transação bancária continua com status `CONCILIADO` no banco.
*   **Mitigação**: Toda exclusão de `Baixa` deve rodar um gatilho no backend que:
    1. Subtrai o valor da baixa do `valor_pago` do lançamento. Se o saldo pago zerar, retorna o lançamento para `status = 'EM ABERTO'` e limpa `data_pagamento`.
    2. Retorna o status do movimento de extrato em `movimentos` para `'ABERTO'`.

### Bug E: Omissão de Despesas de Taxa de Cartão na DRE (Distorção Fiscal)
*   **O Cenário**: Um lote de cartões possui R$ 1.000,00 brutos de vendas, R$ 30,00 de taxas cobradas pela adquirente e R$ 970,00 de valor líquido depositado no banco.
*   **O Erro**: Se criarmos apenas o lançamento de receita consolidado com o valor líquido de R$ 970,00, a DRE omitirá a despesa de taxas de cartão (R$ 30,00) e reportará faturamento bruto a menor (R$ 970,00 em vez de R$ 1.000,00), violando as normas de contabilidade DRE/DFC.
*   **Mitigação**: O fechamento do lote deve criar um **Lançamento Desdobrado (Split Entry)**:
    1.  **Lançamento de Receita (`RECEITA`)**: Gravado com `valor_previsto = valor_bruto` (R$ 1.000,00) na categoria de receitas da loja.
    2.  **Lançamento de Despesa (`DESPESA`)**: Criado automaticamente com `valor_previsto = valor_taxa` (R$ 30,00) na categoria de taxas de cartão (ex: `'02.01.05'`).
    3.  Ambos são marcados como `PAGO` e vinculados ao mesmo banco. O saldo contábil líquido é alterado exatamente em R$ 970,00, batendo 100% com o extrato bancário (`movimentos`).

---

## 5. MODELAGEM E DATA MIGRATION HISTÓRICO OTIMIZADO (ALEMBIC)

```python
"""normalize pdv_movimentacoes and migrate history safely using set-based SQL

Revision ID: normalize_pdv_mov_004
Revises: previous_revision
Create Date: 2026-07-22

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # --- PARTE 1: SCHEMA UPGRADE ---
    op.add_column('pdv_movimentacoes', sa.Column('numero_parcela', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('lote_cartao_itens', sa.Column('pdv_movimentacao_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_lote_cartao_itens_pdv_mov', 
        'lote_cartao_itens', 'pdv_movimentacoes', 
        ['pdv_movimentacao_id'], ['id'], 
        ondelete='CASCADE'
    )

    # --- PARTE 2: EXPLOSÃO HISTÓRICA E AJUSTES DE DATAS (SET-BASED POSTGRESQL) ---
    connection = op.get_bind()

    connection.execute(sa.text("""
        INSERT INTO pdv_movimentacoes (
            created_at, updated_at, is_deleted, empresa_id, tipo, descricao, valor, 
            forma_pagamento, bandeira, parcelas, numero_parcela, data, centro_custo_id, 
            conta_id, conciliado, venda_id, import_hash
        )
        SELECT 
            NOW(), NOW(), false, pm.empresa_id, pm.tipo, 
            'Parcela ' || gs.i || '/' || pm.parcelas || ' - ' || pm.descricao,
            round(pm.valor / pm.parcelas, 2) + 
              CASE WHEN gs.i = pm.parcelas THEN (pm.valor - round(pm.valor / pm.parcelas, 2) * pm.parcelas) ELSE 0 END,
            pm.forma_pagamento, pm.bandeira, pm.parcelas, gs.i,
            pm.data + (CASE WHEN pm.forma_pagamento ILIKE '%debito%' THEN INTERVAL '1 day' ELSE gs.i * INTERVAL '1 month' END),
            pm.centro_custo_id, pm.conta_id, pm.conciliado, pm.venda_id,
            CASE WHEN pm.import_hash IS NOT NULL THEN pm.import_hash || '-P' || gs.i ELSE NULL END
        FROM pdv_movimentacoes pm
        CROSS JOIN LATERAL generate_series(2, pm.parcelas) AS gs(i)
        WHERE pm.parcelas > 1 AND pm.numero_parcela = 1;
    """))

    connection.execute(sa.text("""
        UPDATE pdv_movimentacoes 
        SET 
            valor = round(valor / parcelas, 2),
            data = data + (CASE WHEN forma_pagamento ILIKE '%debito%' THEN INTERVAL '1 day' ELSE INTERVAL '1 month' END)
        WHERE parcelas > 1 AND numero_parcela = 1;
    """))

    mapping_query = sa.text("""
        UPDATE lote_cartao_itens lci
        SET pdv_movimentacao_id = pm.id
        FROM lancamentos l
        JOIN pdv_movimentacoes pm ON (
            pm.venda_id = substring(l.observacao from '"venda_id_uuid"\s*:\s*"([^"]+)"')
            AND pm.numero_parcela = COALESCE((substring(l.observacao from '"numero_parcela"\s*:\s*([0-9]+)')::int), 1)
        )
        WHERE l.id = lci.lancamento_id
          AND l.origem = 'PDV' 
          AND pm.forma_pagamento ILIKE 'cartao_%';
    """)
    connection.execute(mapping_query)

    # --- PARTE 3: SCHEMA CLEANUP ---
    op.drop_constraint('lote_cartao_itens_lancamento_id_fkey', 'lote_cartao_itens', type_='foreignkey')
    op.drop_column('lote_cartao_itens', 'lancamento_id')
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
    op.drop_column('pdv_movimentacoes', 'numero_parcela')
    op.drop_index('ix_pdv_movimentacoes_conciliado_fast')
```

---

## 6. GRAVAÇÃO DE VENDAS COM DISTRIBUIÇÃO DE ARREDONDAMENTO E CASCADING SOFT-DELETE

Em `app/services/pdv_service.py`:

```python
from datetime import timedelta
from dateutil.relativedelta import relativedelta

def registrar_venda_pdv(db: Session, dados_venda: PdvVendaCreate, empresa_id: int):
    venda_db = PdvVenda(...)
    db.add(venda_db)
    db.flush()

    for pag in dados_venda.pagamentos:
        if pag.tipo_pagamento.lower() == "dinheiro":
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
        elif "cartao" in pag.tipo_pagamento.lower():
            regra = obter_regra_cartao(db, empresa_id, pag.tipo_pagamento, pag.bandeira, venda_db.centro_custo_id)
            
            total_p = pag.numero_parcelas or 1
            val_total = Decimal(str(pag.valor))
            
            val_p = (val_total / total_p).quantize(Decimal("0.01"))
            resto = val_total - (val_p * total_p)
            
            for i in range(1, total_p + 1):
                hoje_pag = venda_db.data_venda
                if regra:
                    if regra.modo_parcelamento == "ANTECIPADO":
                        vencimento = calcular_payout_date(hoje_pag, regra)
                    else:
                        base_installment_date = shift_months(hoje_pag, i - 1)
                        vencimento = calcular_payout_date(base_installment_date, regra)
                else:
                    prazo = 1 if "debito" in pag.tipo_pagamento.lower() else 30 * i
                    vencimento = hoje_pag + timedelta(days=prazo)
                
                valor_final_parcela = val_p + resto if i == total_p else val_p
                hash_unico = f"{dados_venda.import_hash}-P{i}" if dados_venda.import_hash else None
                
                mov = PdvMovimentacao(
                    empresa_id=empresa_id,
                    tipo="RECEITA",
                    descricao=f"Parcela {i}/{total_p} Venda PDV {venda_db.id}",
                    valor=valor_final_parcela,
                    forma_pagamento=pag.tipo_pagamento,
                    bandeira=pag.bandeira,
                    parcelas=total_p,
                    numero_parcela=i,
                    data=vencimento,
                    venda_id=venda_db.id,
                    conciliado=False,
                    import_hash=hash_unico
                )
                db.add(mov)
    db.commit()
```

---

## 7. REESCRITA DAS APIS DE RECEBÍVEIS E MOVIMENTAÇÕES COM JOIN DE VENDAS

### 7.1. API `/pdv/recebiveis` (Conciliadora)

```python
@router.get("/recebiveis")
def listar_recebiveis_cartao(
    start_date: date = Query(...),
    end_date: date = Query(...),
    empresa_id: int = Query(...),
    db: Session = Depends(get_db)
):
    regras = db.execute(
        select(RegraCartao).where(RegraCartao.empresa_id == empresa_id, RegraCartao.is_deleted == False)
    ).scalars().all()
    
    taxa_map = {}
    for r in regras:
        b_key = r.bandeira.upper() if r.bandeira else "OUTROS"
        m_key = r.tipo_pagamento.upper() if r.tipo_pagamento else "CREDITO"
        taxa_map[(b_key, m_key)] = float(r.taxa)

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
        
        taxa_percentual = taxa_map.get((bandeira_limpa, modalidade)) or (2.0 if modalidade == "DEBITO" else 3.5)
        valor_bruto = float(mov.valor)
        valor_taxa = round(valor_bruto * (taxa_percentual / 100.0), 2)
        valor_liquido = round(valor_bruto - valor_taxa, 2)
        
        recebiveis.append({
            "id": mov.id,
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

### 7.2. API `/pdv/movimentacoes` (Histórico de Caixa do Terminal)

```python
from app.models.usuario import Usuario
from app.models.entidade import Entidade

@router.get("/movimentacoes")
def listar_movimentacoes_pdv(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user),
    mes: Optional[str] = Query(None)
):
    # Lógica de resolução do range de data do mês... (preservada)
    
    stmt = (
        select(
            PdvMovimentacao, 
            Usuario.nome.label("vendedor_nome"), 
            Entidade.nome.label("cliente_nome")
        )
        .join(PdvVenda, PdvVenda.id == PdvMovimentacao.venda_id, isouter=True)
        .join(Usuario, Usuario.id == PdvVenda.vendedor_id, isouter=True)
        .join(Entidade, Entidade.id == PdvVenda.entidade_id, isouter=True)
        .where(
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False,
            PdvMovimentacao.data >= start_date,
            PdvMovimentacao.data < end_date
        )
        .order_by(PdvMovimentacao.data.desc(), PdvMovimentacao.id.desc())
    )
    
    resultados = db.execute(stmt).all()
    movimentacoes = []
    
    for row in resultados:
        m, vendedor_nome, cliente_nome = row
        movimentacoes.append({
            "id": m.id,
            "id_parcelamento": m.venda_id,
            "tipo": m.tipo,
            "descricao": m.descricao,
            "valor": float(m.valor),
            "forma_pagamento": m.forma_pagamento,
            "bandeira": m.bandeira,
            "parcelas": m.parcelas,
            "data": str(m.data),
            "centro_custo_id": m.centro_custo_id,
            "conta_id": m.conta_id,
            "conciliado": m.conciliado,
            "vendedor_nome": vendedor_nome or "N/A (Movimentação Caixa)",
            "cliente_nome": cliente_nome or "Consumidor Final"
        })
    return movimentacoes
```

---

## 8. ENDPOINTS DE EDIÇÃO SEGURA E ESTORNO (CANCELAMENTO)

### 8.1. API de Conciliação Bancária Automática (Split Entry / Lançamento Desdobrado)

```python
from app.models.baixa import Baixa
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.lote_cartao import LoteCartao
from app.models.lote_cartao_item import LoteCartaoItem

class ConciliarLoteSchema(BaseModel):
    empresa_id: int
    data_pagamento: date
    valor_bruto: float
    valor_taxa: float
    valor_liquido: float
    conta_destino_id: int
    movimentacao_ids: List[int]
    movimento_ofx_id: Optional[int] = None

@router.post("/conciliacao/lotes")
def conciliar_lote_cartao(payload: ConciliarLoteSchema, db: Session = Depends(get_db)):
    try:
        # 1. LANÇAMENTO DESDOBRADO DE RECEITA (Valor Bruto Integral)
        lancamento_receita = Lancamento(
            empresa_id=payload.empresa_id,
            tipo="RECEITA",
            valor_previsto=payload.valor_bruto,
            valor_pago=payload.valor_bruto,
            data_vencimento=payload.data_pagamento,
            data_pagamento=payload.data_pagamento,
            status="PAGO",
            origem="CONCILIACAO_CARTAO",
            descricao="Faturamento Bruto - Lote Cartões Reconciliado"
        )
        db.add(lancamento_receita)
        
        # 2. LANÇAMENTO DESDOBRADO DE DESPESA (Taxa Retida da Adquirente)
        lancamento_despesa_taxa = Lancamento(
            empresa_id=payload.empresa_id,
            tipo="DESPESA",
            valor_previsto=payload.valor_taxa,
            valor_pago=payload.valor_taxa,
            data_vencimento=payload.data_pagamento,
            data_pagamento=payload.data_pagamento,
            status="PAGO",
            origem="CONCILIACAO_CARTAO",
            descricao="Tarifas / Taxas de Administração de Cartões",
            plano_contas_id=obter_categoria_taxas_cartao(db, payload.empresa_id) # ex: '02.01.05'
        )
        db.add(lancamento_despesa_taxa)
        db.flush()
        
        # 3. Criar o cabeçalho do lote
        lote = LoteCartao(
            empresa_id=payload.empresa_id,
            data_pagamento=payload.data_pagamento,
            valor_bruto=payload.valor_bruto,
            valor_taxa=payload.valor_taxa,
            valor_liquido=payload.valor_liquido,
            conta_destino_id=payload.conta_destino_id,
            lancamento_deposito_id=lancamento_receita.id, # Link ao faturamento bruto
            status="CONCILIADO"
        )
        db.add(lote)
        db.flush()
        
        # 4. Vincular as parcelas
        for mov_id in payload.movimentacao_ids:
            mov = db.get(PdvMovimentacao, mov_id)
            if mov:
                mov.conciliado = True
                item = LoteCartaoItem(
                    lote_cartao_id=lote.id,
                    pdv_movimentacao_id=mov.id,
                    valor_bruto=mov.valor,
                    valor_taxa=0.0,
                    valor_liquido=mov.valor
                )
                db.add(item)

        # 5. BAIXA DO EXTRATO BANCÁRIO (Vincula a receita bruta ao extrato)
        if payload.movimento_ofx_id:
            mov_ofx = db.get(Movimento, payload.movimento_ofx_id)
            if mov_ofx:
                # O valor pago na baixa é exatamente o valor líquido creditado no extrato (R$ 970,00)
                baixa = Baixa(
                    empresa_id=payload.empresa_id,
                    lancamento_id=lancamento_receita.id,
                    movimento_id=mov_ofx.id,
                    valor_pago=payload.valor_liquido, # Casamento exato com o valor do extrato
                    data_baixa=payload.data_pagamento,
                    tipo_baixa="PRINCIPAL",
                    is_deleted=False
                )
                db.add(baixa)
                mov_ofx.status = "CONCILIADO"
                db.add(mov_ofx)

        db.commit()
        return {"status": "success", "lote_id": lote.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

### 8.2. Rota DELETE de Desfazimento (Estorno) de Lote Conciliado:

```python
@router.delete("/conciliacao/lotes/{lote_id}")
def estornar_lote_cartao(lote_id: int, db: Session = Depends(get_db)):
    lote = db.get(LoteCartao, lote_id)
    if not lote:
        raise HTTPException(status_code=404, detail="Lote não encontrado")
        
    try:
        # 1. Resetar status de conciliado para False em pdv_movimentacoes
        itens = db.execute(
            select(LoteCartaoItem).where(LoteCartaoItem.lote_cartao_id == lote_id)
        ).scalars().all()
        
        for item in itens:
            mov = db.get(PdvMovimentacao, item.pdv_movimentacao_id)
            if mov:
                mov.conciliado = False
                db.add(mov)
            db.delete(item)
            
        # 2. Deletar a baixa do extrato OFX se houver
        if lote.lancamento_deposito_id:
            baixa = db.execute(
                select(Baixa).where(Baixa.lancamento_id == lote.lancamento_deposito_id, Baixa.is_deleted == False)
            ).scalar_one_or_none()
            
            if baixa:
                # Reverter status do movimento do extrato para ABERTO
                mov_ofx = db.get(Movimento, baixa.movimento_id)
                if mov_ofx:
                    mov_ofx.status = "ABERTO"
                    db.add(mov_ofx)
                db.delete(baixa)
                
            # 3. Apagar o lançamento de Receita Bruta
            receita = db.get(Lancamento, lote.lancamento_deposito_id)
            if receita:
                db.delete(receita)
                
        # 4. Localizar e apagar a despesa de taxa de cartão correspondente
        despesa_taxa = db.execute(
            select(Lancamento).where(
                Lancamento.empresa_id == lote.empresa_id,
                Lancamento.origem == "CONCILIACAO_CARTAO",
                Lancamento.tipo == "DESPESA",
                Lancamento.valor_previsto == lote.valor_taxa,
                Lancamento.data_pagamento == lote.data_pagamento
            )
        ).first()
        if despesa_taxa:
            db.delete(despesa_taxa)
                
        db.delete(lote)
        db.commit()
        return {"message": "Lote estornado com sucesso. Recebíveis e extratos reabertos."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

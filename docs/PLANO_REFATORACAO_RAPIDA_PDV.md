[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER (PESSIMISTIC & ROBUST EDITION)

Este documento é a especificação técnica final, cética e rigorosa para guiar a refatoração do módulo de conciliação de cartões e recebíveis no Kyrus ERP. Ele prevê e neutraliza falhas críticas de dados órfãos, erros de centavos (arredondamento), edição indesejada de dados conciliados e falhas de rollback.

---

## 🗺️ ÍNDICE
1. [Diretrizes de Segurança e Políticas de Não-Quebra](#1-diretrizes-de-seguranca-e-politicas-de-nao-quebra)
2. [Análise de Riscos e Mitigação de Bugs Ocultos](#2-analise-de-riscos-e-mitigacao-de-bugs-ocultos)
3. [Modelagem e Data Migration Histórico (Alembic)](#3-modelagem-e-data-migration-historico-alembic)
4. [Persistência de Vendas e Algoritmo de Distribuição de Restos](#4-persistencia-de-vendas-e-algoritmo-de-distribuicao-de-restos)
5. [Reescrita das APIs do Backend e Taxas Dinâmicas](#5-reescrita-das-apis-do-backend-e-taxas-dinamicas)
6. [Novos Endpoints de Edição e Estorno (Cancelamento)](#6-novos-endpoints-de-edicao-e-estorno-cancelamento)
7. [Checklist de Verificação e Plano de Rollback de Emergência](#7-checklist-de-verificacao-e-plano-de-rollback-de-emergencia)

---

## 1. DIRETRIZES DE SEGURANÇA E POLÍTICAS DE NÃO-QUEBRA

Durante a execução da refatoração, a IA **DEVE** seguir rigorosamente as seguintes políticas:

1.  **Isolamento de Tenant (Multi-empresa)**: Toda consulta ou escrita SQL deve conter o filtro `empresa_id = :empresa_id`.
2.  **Preservação do Contrato da API**: O JSON de resposta do endpoint `/pdv/recebiveis` deve ter chaves com nomes e tipos idênticos para não quebrar a tipagem React/TS.
3.  **Proibição Absoluta de Modificação de Registros Conciliados**: Nenhuma API ou interface pode permitir a edição de data ou valor de movimentações cujo status de conciliação seja `conciliado = True`.

---

## 2. ANÁLISE DE RISCOS E MITIGAÇÃO DE BUGS OCULTOS

### Risco A: O Bug dos Lançamentos Órfãos no Histórico (Data Loss Catastrófico)
*   **O Problema**: A tabela `pdv_movimentacoes` antiga possui apenas **uma linha** por venda (mesmo se for em 3x). Já os lotes conciliares históricos (`lote_cartao_itens`) apontavam para registros individuais da tabela `lancamentos` (onde as parcelas 2 e 3 existiam fisicamente). Se tentarmos rodar a migração mapeando diretamente, as parcelas 2 e 3 dos lotes históricos não encontrarão linhas correspondentes em `pdv_movimentacoes` e serão **excluídas/corrompidas**.
*   **Mitigação**: O script do Alembic deve executar um passo prévio de **Explosão Histórica**, criando fisicamente as parcelas 2 e 3 na tabela `pdv_movimentacoes` para todas as vendas passadas, antes de realizar a associação das chaves estrangeiras.

### Risco B: O Bug do Centavo Desgarrado (Rounding Discrepancy)
*   **O Problema**: Dividir R$ 100,00 em 3 parcelas gera `100.00 / 3 = 33.3333...`. Arredondando para duas casas decimais, criamos 3 parcelas de R$ 33,33. A soma dá R$ 99,99. Há uma discrepância de **R$ 0,01** que impede a conciliação bancária de bater centavo por centavo com o extrato.
*   **Mitigação**: Implementar a técnica de **Distribuição de Resto** na persistência do PDV. A última parcela deve absorver a diferença de arredondamento.

---

## 3. MODELAGEM E DATA MIGRATION HISTÓRICO (ALEMBIC)

O script de migração do Alembic deve ser escrito exatamente da seguinte forma:

```python
"""normalize pdv_movimentacoes and migrate history

Revision ID: normalize_pdv_mov_002
Revises: previous_revision
Create Date: 2026-07-22

"""
from alembic import op
import sqlalchemy as sa
from datetime import timedelta
from dateutil.relativedelta import relativedelta

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

    # --- PARTE 2: DATA MIGRATION (EXPLOSÃO HISTÓRICA E MAP) ---
    connection = op.get_bind()

    # 2.1. Buscar todas as movimentações históricas que possuem parcelas > 1
    # para criarmos os registros das parcelas subsequentes (2, 3...)
    stmt_historico = sa.text("""
        SELECT id, empresa_id, tipo, descricao, valor, forma_pagamento, bandeira, parcelas, data, centro_custo_id, conta_id, conciliado, venda_id, import_hash
        FROM pdv_movimentacoes
        WHERE parcelas > 1 AND numero_parcela = 1
    """)
    rows = connection.execute(stmt_historico).fetchall()
    
    for row in rows:
        total_p = row.parcelas
        val_total = float(row.valor)
        val_p = round(val_total / total_p, 2)
        resto = round(val_total - (val_p * total_p), 2)
        
        # Atualizar a parcela 1 histórica para o valor proporcional correto
        val_primeira = round(val_p + resto, 2) if total_p == 1 else val_p
        connection.execute(
            sa.text("UPDATE pdv_movimentacoes SET valor = :val WHERE id = :id"),
            {"val": val_primeira, "id": row.id}
        )
        
        # Criar os registros para as parcelas de 2 em diante no banco
        for i in range(2, total_p + 1):
            dias_prazo = 30 * (i - 1)
            data_recebimento = row.data + timedelta(days=dias_prazo)
            val_atual = round(val_p + resto, 2) if i == total_p else val_p
            
            connection.execute(sa.text("""
                INSERT INTO pdv_movimentacoes (
                    created_at, updated_at, is_deleted, empresa_id, tipo, descricao, valor, 
                    forma_pagamento, bandeira, parcelas, numero_parcela, data, centro_custo_id, 
                    conta_id, conciliado, venda_id, import_hash
                ) VALUES (
                    NOW(), NOW(), false, :empresa_id, :tipo, :descricao, :valor, 
                    :forma_pagamento, :bandeira, :parcelas, :numero_parcela, :data, :centro_custo_id, 
                    :conta_id, :conciliado, :venda_id, :import_hash
                )
            """), {
                "empresa_id": row.empresa_id, "tipo": row.tipo, "descricao": f"Parcela {i}/{total_p} - {row.descricao}",
                "valor": val_atual, "forma_pagamento": row.forma_pagamento, "bandeira": row.bandeira,
                "parcelas": total_p, "numero_parcela": i, "data": data_recebimento,
                "centro_custo_id": row.centro_custo_id, "conta_id": row.conta_id, "conciliado": row.conciliado,
                "venda_id": row.venda_id, "import_hash": f"{row.import_hash}-P{i}" if row.import_hash else None
            })

    # 2.2. Agora mapear as chaves de lote_cartao_itens para as novas movimentações explodidas
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
    for r in results:
        connection.execute(
            sa.text("UPDATE lote_cartao_itens SET pdv_movimentacao_id = :mov_id WHERE id = :item_id"),
            {"mov_id": r.mov_id, "item_id": r.item_id}
        )

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
    # Remove as colunas e índices adicionados
    op.drop_constraint('fk_lote_cartao_itens_pdv_mov', 'lote_cartao_itens', type_='foreignkey')
    op.drop_column('lote_cartao_itens', 'pdv_movimentacao_id')
    op.drop_column('pdv_movimentacoes', 'numero_parcela')
    op.drop_index('ix_pdv_movimentacoes_conciliado_fast')
```

---

## 4. PERSISTÊNCIA DE VENDAS E ALGORITMO DE DISTRIBUIÇÃO DE RESTOS

No arquivo `app/services/pdv_service.py`, na gravação final da venda:

```python
def registrar_venda_pdv(db: Session, dados_venda: VendaCreateSchema, empresa_id: int):
    # Inserir cabeçalho
    venda_db = PdvVenda(...)
    db.add(venda_db)
    db.flush()

    for pag in dados_venda.pagamentos:
        if pag.forma_pagamento.lower() == "dinheiro":
            # Dinheiro físico gera lançamento imediato
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
            total_p = pag.parcelas or 1
            val_total = float(pag.valor)
            
            # ALGORITMO DE DISTRIBUIÇÃO DE RESTO (Sem perda de centavos)
            val_p = round(val_total / total_p, 2)
            resto = round(val_total - (val_p * total_p), 2)
            
            for i in range(1, total_p + 1):
                dias_prazo = 1 if "debito" in pag.forma_pagamento.lower() else 30 * i
                data_recebimento = venda_db.data_venda + timedelta(days=dias_prazo)
                
                # A última parcela absorve a diferença de arredondamento
                valor_final_parcela = round(val_p + resto, 2) if i == total_p else val_p
                
                mov = PdvMovimentacao(
                    empresa_id=empresa_id,
                    tipo="RECEITA",
                    descricao=f"Parcela {i}/{total_p} Venda PDV {venda_db.id}",
                    valor=valor_final_parcela,
                    forma_pagamento=pag.forma_pagamento,
                    bandeira=pag.bandeira,
                    parcelas=total_p,
                    numero_parcela=i,
                    data=data_recebimento,
                    venda_id=venda_db.id,
                    conciliado=False
                )
                db.add(mov)
    db.commit()
```

---

## 5. REESCRITA DAS APIS DO BACKEND E TAXAS DINÂMICAS

A rota GET `/pdv/recebiveis` em `app/api/v1/endpoints/pdv.py` deve carregar as movimentações do banco de dados de forma indexada e rápida:

```python
@router.get("/recebiveis")
def listar_recebiveis_cartao(
    start_date: date = Query(...),
    end_date: date = Query(...),
    empresa_id: int = Query(...),
    db: Session = Depends(get_db)
):
    # Carregar taxas
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

---

## 6. NOVOS ENDPOINTS DE EDIÇÃO E ESTORNO (CANCELAMENTO)

Para garantir que dados conciliados não sofram corrupção por edições manuais, implemente validações rígidas:

### Rota PUT de Edição Manual de Recebível:
```python
@router.put("/movimentacoes/{id}")
def atualizar_movimentacao_pdv(id: int, payload: MovimentacaoUpdate, db: Session = Depends(get_db)):
    mov = db.get(PdvMovimentacao, id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
        
    # VALIDAR RESTRIÇÃO DE CONCILIAÇÃO:
    if mov.conciliado:
        raise HTTPException(
            status_code=400, 
            detail="Não é permitido editar movimentações de cartão já conciliadas/pagas. Desfaça a conciliação do lote antes de editar."
        )
        
    if payload.data is not None:
        mov.data = payload.data
    if payload.valor is not None:
        mov.valor = payload.valor
        
    db.commit()
    return {"message": "Movimentação atualizada com sucesso"}
```

### Rota DELETE de Desfazimento (Estorno) de Lote Conciliado:
Caso o usuário cancele a conciliação de um lote no banco, as movimentações de cartão devem retornar ao estado pendente:

```python
@router.delete("/conciliacao/lotes/{lote_id}")
def estornar_lote_cartao(lote_id: int, db: Session = Depends(get_db)):
    lote = db.get(LoteCartao, lote_id)
    if not lote:
        raise HTTPException(status_code=404, detail="Lote não encontrado")
        
    try:
        # 1. Buscar itens do lote
        itens = db.execute(
            select(LoteCartaoItem).where(LoteCartaoItem.lote_cartao_id == lote_id)
        ).scalars().all()
        
        # 2. Resetar status de conciliado para False em pdv_movimentacoes
        for item in itens:
            mov = db.get(PdvMovimentacao, item.pdv_movimentacao_id)
            if mov:
                mov.conciliado = False
                
        # 3. Remover os itens e o cabeçalho do lote
        for item in itens:
            db.delete(item)
            
        # 4. Apagar o lançamento bancário consolidado associado (estorno do extrato)
        if lote.lancamento_deposito_id:
            deposito = db.get(Lancamento, lote.lancamento_deposito_id)
            if deposito:
                db.delete(deposito)
                
        db.delete(lote)
        db.commit()
        return {"message": "Lote estornado com sucesso. Recebíveis retornaram ao estado aberto."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

---

## 7. CHECKLIST DE VERIFICAÇÃO E PLANO DE ROLLBACK DE EMERGÊNCIA

### A. Auditoria Automatizada Pós-Migration
Imediatamente após rodar o Alembic em homologação/produção, a IA deve rodar este script Python para garantir que nenhuma conciliação histórica foi corrompida:

```python
# scripts/audit_migration.py
import sys
from app.db.session import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    # 1. Checar se existem itens de lote sem pdv_movimentacao_id
    orfaos = db.execute(text("SELECT count(*) FROM lote_cartao_itens WHERE pdv_movimentacao_id IS NULL")).scalar()
    if orfaos > 0:
        print(f"❌ ERRO GRAVE: Encontrados {orfaos} itens de lote órfãos! Abortar e rodar ROLLBACK.")
        sys.exit(1)
        
    # 2. Checar se a soma dos valores de lotes bate com a soma de suas movimentações
    dif = db.execute(text("""
        SELECT count(*) FROM (
            SELECT lc.id, lc.valor_bruto, sum(pm.valor) as sum_v
            FROM lotes_cartao lc
            JOIN lote_cartao_itens lci ON lci.lote_cartao_id = lc.id
            JOIN pdv_movimentacoes pm ON pm.id = lci.pdv_movimentacao_id
            GROUP BY lc.id
        ) q WHERE round(q.valor_bruto::numeric, 2) != round(q.sum_v::numeric, 2)
    """)).scalar()
    
    if dif > 0:
        print(f"❌ ERRO GRAVE: Encontrados {dif} lotes com divergência de centavos entre bruto e itens!")
        sys.exit(1)
        
    print("✅ Sucesso! Migração de dados auditada com 100% de consistência.")
finally:
    db.close()
```

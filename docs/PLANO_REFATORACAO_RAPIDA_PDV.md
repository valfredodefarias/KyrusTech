[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER (EDILÇÃO BLINDADA)

Este documento é a especificação técnica absoluta de engenharia para guiar a refatoração do módulo de conciliação de cartões e recebíveis no Kyrus ERP. Ele mapeia de forma cética todas as armadilhas de concorrência, erros de arredondamento, colisão de unicidade e resolve a migração histórica de alta escala usando processamento baseado em conjuntos no PostgreSQL.

---

## 🗺️ ÍNDICE
1. [Diretrizes de Segurança e Políticas de Não-Quebra](#1-diretrizes-de-seguranca-e-politicas-de-nao-quebra)
2. [Análise Avançada de Riscos e Solução de Bugs Ocultos](#2-analise-avancada-de-riscos-e-solucao-de-bugs-ocultos)
3. [Modelagem e Data Migration Histórico Otimizado (Alembic)](#3-modelagem-e-data-migration-historico-otimizado-alembic)
4. [Gravação de Vendas com Distribuição de Arredondamento e Cascading Soft-Delete](#4-gravacao-de-vendas-com-distribuicao-de-arredondamento-e-cascading-soft-delete)
5. [Reescrita das APIs do Backend e Mapeamento Limpo](#5-reescrita-das-apis-do-backend-e-mapeamento-limpo)
6. [Endpoints de Edição Segura e Estorno (Cancelamento)](#6-endpoints-de-edicao-segura-e-estorno-cancelamento)
7. [Checklist de Homologação e Script de Auditoria Pós-Migration](#7-checklist-de-homologacao-e-script-de-auditoria-pos-migration)

---

## 1. DIRETRIZES DE SEGURANÇA E POLÍTICAS DE NÃO-QUEBRA

Durante a execução da refatoração, a IA **DEVE** seguir rigorosamente as seguintes políticas:

1.  **Isolamento de Tenant (Multi-empresa)**: Toda consulta ou escrita SQL deve conter o filtro `empresa_id = :empresa_id`.
2.  **Preservação do Contrato da API**: O JSON de resposta do endpoint `/pdv/recebiveis` deve ter chaves com nomes e tipos idênticos para não quebrar a tipagem React/TS.
3.  **Proibição Absoluta de Modificação de Registros Conciliados**: Nenhuma API ou interface pode permitir a edição de data ou valor de movimentações cujo status de conciliação seja `conciliado = True`.

---

## 2. ANÁLISE AVANÇADA DE RISCOS E SOLUÇÃO DE BUGS OCULTOS

### Risco A: Falha na Conversão SQL `observacao::json` (Crash Geral de Migração)
*   **O Problema**: A coluna `observacao` da tabela `lancamentos` contém texto livre em 98% dos registros. Tentar converter essa coluna diretamente para JSON no Postgres (`l.observacao::json`) fará a migração falhar com erro de sintaxe de JSON inválido, paralisando a atualização do banco de dados na produção.
*   **Mitigação**: Utilizar funções de extração por **Expressão Regular (Regex)** nativas do Postgres (`substring`), que buscam o padrão de texto do UUID e das parcelas de forma segura, retornando `NULL` sem quebrar a consulta se a linha não contiver JSON.

### Risco B: Desalinhamento Temporal por Dias Fixos (Calendar Drift)
*   **O Problema**: Utilizar `timedelta(days=30 * i)` para calcular a data das parcelas faz com que a data de vencimento se desalinhe rapidamente com o calendário real (ex: uma venda em 31 de Janeiro venceria em 2 de Março em vez de 28 de Fevereiro). Os calendários de adquirentes seguem o padrão de meses relativos.
*   **Mitigação**: Utilizar `relativedelta(months=i)` no Python e `INTERVAL '1 month'` no SQL para calcular a data exata de vencimento das parcelas subsequentes.

### Risco C: Colisão de Chave Única em `import_hash`
*   **O Problema**: A tabela `pdv_movimentacoes` possui uma restrição de chave única (`UNIQUE`) no campo `import_hash`. Se uma venda de R$ 300,00 possuir um `import_hash` único e a explodirmos em 3 parcelas de R$ 100,00, tentar inserir o mesmo `import_hash` nas 3 parcelas gerará violação de unicidade no banco.
*   **Mitigação**: Modificar o gerador de hash para concatenar o sufixo da parcela (ex: `"{hash_original}-P{numero_parcela}"`).

### Risco D: Gargalo de Performance por Loops N+1 no Alembic
*   **O Problema**: Ler milhares de movimentações antigas em Python e fazer `INSERT` individual em um loop causará timeout de transação em produção.
*   **Mitigação**: Executar a explosão histórica e a distribuição de arredondamento em uma **única query baseada em conjuntos no PostgreSQL** usando `generate_series` e `CROSS JOIN LATERAL`.

---

## 3. MODELAGEM E DATA MIGRATION HISTÓRICO OTIMIZADO (ALEMBIC)

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

    # 2.1. Duplicar as parcelas 2 em diante diretamente no Postgres
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

    # 2.2. Atualizar o valor e a data da primeira parcela histórica
    connection.execute(sa.text("""
        UPDATE pdv_movimentacoes 
        SET 
            valor = round(valor / parcelas, 2),
            data = data + (CASE WHEN forma_pagamento ILIKE '%debito%' THEN INTERVAL '1 day' ELSE INTERVAL '1 month' END)
        WHERE parcelas > 1 AND numero_parcela = 1;
    """))

    # 2.3. Mapear as chaves de junção do lote para os novos registros explodidos
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

## 4. GRAVAÇÃO DE VENDAS COM DISTRIBUIÇÃO DE ARREDONDAMENTO E CASCADING SOFT-DELETE

Em `app/services/pdv_service.py`:

```python
from datetime import timedelta
from dateutil.relativedelta import relativedelta

def registrar_venda_pdv(db: Session, dados_venda: VendaCreateSchema, empresa_id: int):
    venda_db = PdvVenda(...)
    db.add(venda_db)
    db.flush()

    for pag in dados_venda.pagamentos:
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
        elif "cartao" in pag.forma_pagamento.lower():
            total_p = pag.parcelas or 1
            val_total = float(pag.valor)
            
            val_p = round(val_total / total_p, 2)
            resto = round(val_total - (val_p * total_p), 2)
            
            for i in range(1, total_p + 1):
                # Usar relativedelta para evitar drift de calendário
                if "debito" in pag.forma_pagamento.lower():
                    data_recebimento = venda_db.data_venda + timedelta(days=1)
                else:
                    data_recebimento = venda_db.data_venda + relativedelta(months=i)
                
                valor_final_parcela = round(val_p + resto, 2) if i == total_p else val_p
                hash_unico = f"{dados_venda.import_hash}-P{i}" if dados_venda.import_hash else None
                
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
                    conciliado=False,
                    import_hash=hash_unico
                )
                db.add(mov)
    db.commit()
```

---

## 5. REESCRITA DAS APIS DO BACKEND E MAPEAMENTO LIMPO

A API `/pdv/recebiveis` em `app/api/v1/endpoints/pdv.py` retorna os recebíveis indexados diretamente:

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

---

## 6. ENDPOINTS DE EDIÇÃO SEGURA E ESTORNO (CANCELAMENTO)

```python
class MovimentacaoUpdate(BaseModel):
    data: Optional[date] = None
    valor: Optional[float] = None

@router.put("/movimentacoes/{id}")
def atualizar_movimentacao_pdv(id: int, payload: MovimentacaoUpdate, db: Session = Depends(get_db)):
    mov = db.get(PdvMovimentacao, id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
        
    if mov.conciliado:
        raise HTTPException(
            status_code=400, 
            detail="Modificação bloqueada: este recebível já está associado a um lote bancário pago."
        )
        
    if payload.data is not None:
        mov.data = payload.data
    if payload.valor is not None:
        mov.valor = payload.valor
        
    db.commit()
    return {"message": "Movimentação updated com sucesso"}
```

---

## 7. CHECKLIST DE HOMOLOGAÇÃO E SCRIPT DE AUDITORIA PÓS-MIGRATION

Após a migração, a IA executora deve executar `scripts/audit_migration.py`. Note que aceitamos registros órfãos históricos se o lançamento correspondente não possuir venda associada no banco.

```python
# scripts/audit_migration.py
import sys
from app.db.session import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    # 1. Validar registros órfãos que possuíam venda válida no banco
    orfaos = db.execute(text("""
        SELECT count(lci.id) 
        FROM lote_cartao_itens lci 
        JOIN lancamentos l ON l.id = lci.lancamento_id
        WHERE lci.pdv_movimentacao_id IS NULL
          AND substring(l.observacao from '"venda_id_uuid"\s*:\s*"([^"]+)"') IN (SELECT id FROM pdv_vendas)
    """)).scalar()
    
    if orfaos > 0:
        print(f"❌ MIGRATION AUDIT FAILED: {orfaos} itens de lote ativos ficaram órfãos!")
        sys.exit(1)
        
    # 2. Validar integridade matemática de centavos dos lotes
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
        print(f"❌ MIGRATION AUDIT FAILED: {dif} lotes de cartões divergem nos centavos!")
        sys.exit(1)
        
    print("✅ MIGRATION AUDIT PASSED: Lotes e parcelas históricas auditados com sucesso.")
finally:
    db.close()
```

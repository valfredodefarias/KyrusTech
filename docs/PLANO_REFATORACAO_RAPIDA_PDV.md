[🗺️ Visão Geral]([[Visao Geral]]) / [🩹 Erros Estruturais]([[Plano de Refatoracao e Erros Estruturais do PDV]])
***

# 🤖 PLANO DE REFATORAÇÃO E MANUAL DE EXECUÇÃO PARA IA DEVELOPER (5-TABLE RECONCILIATION)

Este documento é a especificação técnica absoluta de engenharia para guiar a refatoração do módulo de conciliação de cartões e recebíveis no Kyrus ERP. Ele mapeia toda a arquitetura financeira de reconciliação bancária de ponta a ponta, conectando as tabelas de vendas do PDV, os recebíveis explodidos, os lotes de cartão, os lançamentos contábeis e as movimentações de extrato bancário (OFX) de forma 100% normalizada.

---

## 🗺️ ÍNDICE
1. [Diretrizes de Segurança e Políticas de Não-Quebra](#1-diretrizes-de-seguranca-e-politicas-de-nao-quebra)
2. [O Ecossistema Relacional de Conciliação (5 Tabelas)](#2-o-ecossistema-relacional-de-conciliacao-5-tabelas)
3. [Modelagem e Data Migration Histórico (Alembic)](#3-modelagem-e-data-migration-historico-alembic)
4. [Gravação de Vendas com Distribuição de Arredondamento e Cascading Soft-Delete](#4-gravacao-de-vendas-com-distribuicao-de-arredondamento-e-cascading-soft-delete)
5. [Reescrita das APIs do Backend e Taxas Dinâmicas](#5-reescrita-das-apis-do-backend-e-mapeamento-limpo)
6. [Novos Endpoints de Conciliação Automática de Extrato (OFX)](#6-novos-endpoints-de-conciliacao-automatica-de-extrato-ofx)
7. [Checklist de Homologação e Script de Auditoria Pós-Migration](#7-checklist-de-homologacao-e-script-de-auditoria-pos-migration)

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
3.  **`lancamentos`**: O lançamento financeiro que representa a entrada de dinheiro real na conta bancária (Itaú, Sicredi, etc.).
4.  **`movimentos`**: A transação física de crédito do extrato bancário importada via arquivo OFX.
5.  **`baixas`**: A tabela de reconciliação que vincula o lançamento de receita (`lancamento_id`) à transação física do extrato (`movimento_id`), marcando a conciliação como concluída.

---

## 3. MODELAGEM E DATA MIGRATION HISTÓRICO OTIMIZADO (ALEMBIC)

O script de migração do Alembic deve ser escrito exatamente da seguinte forma:

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

## 5. REESCRITA DAS APIS DO BACKEND E TAXAS DINÂMICAS

A API `/pdv/recebiveis` em `app/api/v1/endpoints/pdv.py` retorna os recebíveis diretamente da tabela `pdv_movimentacoes`:

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

## 6. NOVOS ENDPOINTS DE CONCILIAÇÃO AUTOMÁTICA DE EXTRATO (OFX)

Para evitar duplicidade de trabalho no fechamento diário, a API de conciliação de lote de cartões passará a aceitar opcionalmente o ID do movimento do extrato bancário (`movimento_ofx_id`), realizando a baixa automática e despesa do lote na mesma transação.

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
    movimento_ofx_id: Optional[int] = None # Opcional: ID da transação importada do OFX

@router.post("/conciliacao/lotes")
def conciliar_lote_cartao(payload: ConciliarLoteSchema, db: Session = Depends(get_db)):
    try:
        # 1. Criar o lançamento financeiro consolidado de depósito bancário
        lancamento_deposito = Lancamento(
            empresa_id=payload.empresa_id,
            tipo="RECEITA",
            valor_previsto=payload.valor_bruto,
            valor_pago=payload.valor_liquido,
            data_vencimento=payload.data_pagamento,
            data_pagamento=payload.data_pagamento,
            status="PAGO",
            origem="CONCILIACAO_CARTAO",
            descricao=f"Depósito Lote Cartões - Líquido Recebido"
        )
        db.add(lancamento_deposito)
        db.flush()
        
        # 2. Criar o lote na tabela lotes_cartao
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
        db.flush()
        
        # 3. Conciliar todas as movimentações e criar os itens de lote
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

        # 4. CONCILIAÇÃO BANCÁRIA AUTOMÁTICA (Integração com a tabela de movimentos OFX)
        if payload.movimento_ofx_id:
            mov_ofx = db.get(Movimento, payload.movimento_ofx_id)
            if mov_ofx:
                # Criar a Baixa vinculando o lançamento consolidado de depósito ao movimento físico do extrato
                baixa = Baixa(
                    empresa_id=payload.empresa_id,
                    lancamento_id=lancamento_deposito.id,
                    movimento_id=mov_ofx.id,
                    valor_pago=payload.valor_liquido,
                    data_baixa=payload.data_pagamento,
                    tipo_baixa="PRINCIPAL",
                    is_deleted=False
                )
                db.add(baixa)
                
                # Atualizar o status do movimento de extrato para CONCILIADO
                mov_ofx.status = "CONCILIADO"
                db.add(mov_ofx)

        db.commit()
        return {"status": "success", "lote_id": lote.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

---

## 7. CHECKLIST DE HOMOLOGAÇÃO E SCRIPT DE AUDITORIA PÓS-MIGRATION

Após a migração, a IA executora deve executar `scripts/audit_migration.py`.

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

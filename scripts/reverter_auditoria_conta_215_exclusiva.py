"""
Script Sniper de Reversão Cirúrgica Exclusiva para a Conta ITAÚ - RMUSIC (ID 215, Empresa ID 27)
Reverte 100% das alterações realizadas HOJE (31/07/2026) exclusivamente para esta conta.
"""
import os
import sys

# Desativa geração de novos audit logs durante a reversão para evitar poluição
os.environ["DISABLE_AUDIT"] = "1"

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine
from app.api.v1.endpoints.importacao_ofx import _calcular_saldo_atual_conta

CONTA_ID = 215
EMPRESA_ID = 27
DATA_HOJE = '2026-07-31 00:00:00'

def reverter_conta_215_hoje():
    print(f"🎯 INICIANDO SCRIPT SNIPER DE REVERSÃO PARA A CONTA {CONTA_ID} (ITAÚ - RMUSIC) - HOJE ({DATA_HOJE[:10]})")

    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = '300s';"))

        # 1. Identificar todos os IDs pertencentes à conta 215 (históricos e atuais)
        lanc_ids = set(conn.execute(text("SELECT id FROM lancamentos WHERE conta_id = :cid"), {'cid': CONTA_ID}).scalars().all())
        mov_ids = set(conn.execute(text("SELECT id FROM movimentos WHERE conta_id = :cid"), {'cid': CONTA_ID}).scalars().all())

        # Adicionar IDs de lancamentos/movimentos presentes nos audit logs de hoje para a conta 215
        logs_hoje = conn.execute(text("""
            SELECT id, table_name, record_id, action, changes, created_at, undone
            FROM audit_logs
            WHERE created_at >= :data_inicio
            ORDER BY id DESC
        """), {'data_inicio': DATA_HOJE}).mappings().all()

        print(f"📋 Total de logs de auditoria analisados hoje: {len(logs_hoje)}")

        # Mapeamento para descobrir o que pertence à conta 215
        for l in logs_hoje:
            table = l['table_name']
            rec_id = l['record_id']
            changes = l['changes'] or {}

            if table == 'lancamentos':
                c_id = changes.get('conta_id', {}).get('old') or changes.get('conta_id', {}).get('new')
                if c_id == CONTA_ID:
                    lanc_ids.add(rec_id)
            elif table == 'movimentos':
                c_id = changes.get('conta_id', {}).get('old') or changes.get('conta_id', {}).get('new')
                if c_id == CONTA_ID:
                    mov_ids.add(rec_id)

        # Buscar baixas atreladas a estes lancamentos ou movimentos
        baixa_ids = set(conn.execute(text("""
            SELECT id FROM baixas WHERE lancamento_id = ANY(:lids) OR movimento_id = ANY(:mids)
        """), {'lids': list(lanc_ids) or [-1], 'mids': list(mov_ids) or [-1]}).scalars().all())

        # Adicionar baixas dos audit logs de hoje
        for l in logs_hoje:
            if l['table_name'] == 'baixas':
                changes = l['changes'] or {}
                l_id = changes.get('lancamento_id', {}).get('old') or changes.get('lancamento_id', {}).get('new')
                m_id = changes.get('movimento_id', {}).get('old') or changes.get('movimento_id', {}).get('new')
                if (l_id and l_id in lanc_ids) or (m_id and m_id in mov_ids):
                    baixa_ids.add(l['record_id'])

        print(f"📊 Registros mapeados exclusivamente para Conta {CONTA_ID}:")
        print(f"   - Lançamentos: {len(lanc_ids)}")
        print(f"   - Movimentos: {len(mov_ids)}")
        print(f"   - Baixas: {len(baixa_ids)}")

        # 2. Filtrar logs que PERTENCEM EXCLUSIVAMENTE à Conta 215
        logs_filtrados = []
        for l in logs_hoje:
            table = l['table_name']
            rec_id = l['record_id']

            pertence = False
            if table == 'contas' and rec_id == CONTA_ID:
                pertence = True
            elif table == 'lancamentos' and rec_id in lanc_ids:
                pertence = True
            elif table == 'movimentos' and rec_id in mov_ids:
                pertence = True
            elif table == 'baixas' and rec_id in baixa_ids:
                pertence = True

            if pertence:
                logs_filtrados.append(l)

        print(f"⚡ Audit logs a reverter exclusivamente para Conta {CONTA_ID}: {len(logs_filtrados)}")

        # 3. Executar reversão em ordem decrescente (mais recente para mais antigo)
        revertidos = 0
        erros = 0

        for l in logs_filtrados:
            table = l['table_name']
            rec_id = l['record_id']
            action = l['action']
            changes = l['changes'] or {}

            try:
                sp = conn.begin_nested()

                if action == 'UPDATE' and changes:
                    set_clauses = []
                    params = {'rec_id': rec_id}

                    for field, val_dict in changes.items():
                        if field == 'id':
                            continue
                        old_val = val_dict.get('old')
                        param_name = f"val_{field}"
                        set_clauses.append(f"{field} = :{param_name}")
                        params[param_name] = old_val

                    if set_clauses:
                        sql = f"UPDATE {table} SET {', '.join(set_clauses)} WHERE id = :rec_id"
                        conn.execute(text(sql), params)
                        revertidos += 1

                elif action in ('SOFT_DELETE', 'DELETE_SOFT') or (action == 'UPDATE' and 'is_deleted' in changes and changes['is_deleted'].get('new') is True):
                    conn.execute(text(f"UPDATE {table} SET is_deleted = false, deleted_at = NULL WHERE id = :rec_id"), {'rec_id': rec_id})
                    revertidos += 1

                elif action in ('CREATE', 'INSERT'):
                    conn.execute(text(f"UPDATE {table} SET is_deleted = true WHERE id = :rec_id"), {'rec_id': rec_id})
                    revertidos += 1

                conn.execute(text("UPDATE audit_logs SET undone = true WHERE id = :id"), {'id': l['id']})
                sp.commit()
            except Exception as e:
                sp.rollback()
                print(f"⚠️ Erro ao reverter log {l['id']} ({table} ID {rec_id}): {e}")
                erros += 1

        # 4. Ajustes finos de consistência pós-reversão para a Conta 215
        # 4.1. Reset de status dos movimentos OFX para ABERTO
        conn.execute(text("""
            UPDATE movimentos
            SET status = 'ABERTO'
            WHERE conta_id = :cid AND (data >= '2026-07-30' OR created_at >= :data_inicio)
        """), {'cid': CONTA_ID, 'data_inicio': DATA_HOJE})

        # 4.2. Recalcular baixas e lançamentos ativas para a Conta 215
        conn.execute(text("""
            WITH baixas_agg AS (
                SELECT 
                    b.lancamento_id,
                    SUM(CASE WHEN b.tipo_baixa = 'PRINCIPAL' THEN b.valor_pago ELSE 0 END) AS principal,
                    SUM(CASE WHEN b.tipo_baixa = 'JUROS' THEN b.valor_pago ELSE 0 END) AS juros,
                    SUM(CASE WHEN b.tipo_baixa = 'MULTA' THEN b.valor_pago ELSE 0 END) AS multa,
                    SUM(CASE WHEN b.tipo_baixa = 'DESCONTO' THEN b.valor_pago ELSE 0 END) AS desconto,
                    MAX(b.data_baixa) AS max_data_baixa,
                    COUNT(b.id) AS total_baixas
                FROM baixas b
                JOIN lancamentos l ON l.id = b.lancamento_id
                WHERE b.is_deleted = false AND l.empresa_id = :eid AND l.conta_id = :cid
                GROUP BY b.lancamento_id
            )
            UPDATE lancamentos
            SET 
                valor_pago = COALESCE(ba.principal + ba.juros + ba.multa - ba.desconto, 0.00),
                valor_juros = COALESCE(ba.juros, 0.00),
                valor_multa = COALESCE(ba.multa, 0.00),
                valor_desconto = COALESCE(ba.desconto, 0.00),
                data_pagamento = ba.max_data_baixa,
                conciliado = CASE WHEN ba.total_baixas > 0 THEN true ELSE false END,
                status = CASE 
                    WHEN ba.total_baixas > 0 AND (lancamentos.valor_previsto - (ba.principal + ba.desconto)) <= 0.01 THEN 'PAGO'
                    WHEN ba.total_baixas > 0 THEN 'PARCIAL'
                    ELSE 'EM ABERTO'
                END
            FROM baixas_agg ba
            WHERE lancamentos.id = ba.lancamento_id
              AND lancamentos.empresa_id = :eid AND lancamentos.conta_id = :cid AND lancamentos.is_deleted = false
        """), {'eid': EMPRESA_ID, 'cid': CONTA_ID})

        # 4.3. Resetar lançamentos da Conta 215 sem baixas ativas
        conn.execute(text("""
            UPDATE lancamentos
            SET valor_pago = 0.00, valor_juros = 0.00, valor_multa = 0.00, valor_desconto = 0.00,
                data_pagamento = NULL, conciliado = false, status = 'EM ABERTO'
            WHERE empresa_id = :eid AND conta_id = :cid AND is_deleted = false
              AND id NOT IN (
                  SELECT b.lancamento_id 
                  FROM baixas b 
                  JOIN lancamentos l ON l.id = b.lancamento_id
                  WHERE b.is_deleted = false AND l.empresa_id = :eid AND l.conta_id = :cid
              )
        """), {'eid': EMPRESA_ID, 'cid': CONTA_ID})

        conn.commit()
        print(f"✅ Reversão cirúrgica efetuada! {revertidos} alterações desfeitas | {erros} erros")

    # 5. Recalcular e exibir o saldo final atualizado da Conta 215
    with Session(engine) as db:
        saldo = _calcular_saldo_atual_conta(db, empresa_id=EMPRESA_ID, conta_id=CONTA_ID)
        print(f"💰 SALDO RESTAURADO DA CONTA {CONTA_ID} (ITAÚ - RMUSIC): R$ {saldo:,.2f}")

if __name__ == '__main__':
    reverter_conta_215_hoje()

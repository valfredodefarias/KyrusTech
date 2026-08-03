import sys
from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine
from app.api.v1.endpoints.importacao_ofx import _calcular_saldo_atual_conta

def reverter_auditoria_hoje():
    with engine.connect() as conn:
        print("=== REVERTENDO 100% DAS AÇÕES DO AUDIT_LOGS DE HOJE (31/07/2026) ===")
        conn.execute(text("SET statement_timeout = 0;"))

        logs = conn.execute(text("""
            SELECT id, table_name, record_id, action, changes, created_at
            FROM audit_logs
            WHERE created_at >= '2026-07-31 00:00:00'
            ORDER BY id DESC
        """)).mappings().all()

        print(f"Total de ações registradas na auditoria de hoje a reverter: {len(logs)}")
        revertidos = 0
        erros = 0

        for l in logs:
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
                        old_val = val_dict.get('old')
                        param_name = f"val_{field}"
                        set_clauses.append(f"{field} = :{param_name}")
                        params[param_name] = old_val

                    if set_clauses:
                        sql = f"UPDATE {table} SET {', '.join(set_clauses)} WHERE id = :rec_id"
                        conn.execute(text(sql), params)
                        revertidos += 1

                elif action in ('SOFT_DELETE', 'DELETE_SOFT') or (action == 'UPDATE' and changes and 'is_deleted' in changes and changes['is_deleted'].get('new') is True):
                    conn.execute(text(f"UPDATE {table} SET is_deleted = false, deleted_at = NULL WHERE id = :rec_id"), {'rec_id': rec_id})
                    revertidos += 1

                elif action in ('CREATE', 'INSERT'):
                    conn.execute(text(f"UPDATE {table} SET is_deleted = true WHERE id = :rec_id"), {'rec_id': rec_id})
                    revertidos += 1

                sp.commit()
            except Exception as e:
                sp.rollback()
                erros += 1

        conn.execute(text("UPDATE movimentos SET status = 'ABERTO' WHERE conta_id = 215 AND data >= '2026-07-30'"))
        conn.commit()
        print(f"✅ Reversão concluída! Total de ações revertidas: {revertidos} | Erros: {erros}")

    with Session(engine) as db:
        saldo = _calcular_saldo_atual_conta(db, empresa_id=27, conta_id=215)
        print('SALDO FINAL DA CONTA 215:', saldo)

if __name__ == '__main__':
    reverter_auditoria_hoje()

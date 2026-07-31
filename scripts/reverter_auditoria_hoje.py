"""
Script Cirurgico para Reverter EXATAMENTE e UNICAMENTE todas as acoes de Auditoria/OFX registradas no dia de HOJE (31/07/2026).
Restaura os valores 'old' de cada alteracao e nao mexe em nada anterior a hoje.
"""
import os
import sys
from sqlmodel import Session
from sqlalchemy import text

from app.db.session import engine

def reverter_auditoria_hoje():
    with engine.connect() as conn:
        print("=== REVERTENDO 100% DAS AÇÕES DO AUDIT_LOGS DE HOJE (31/07/2026) ===")

        # Desativar statement_timeout
        conn.execute(text("SET statement_timeout = '300s';"))

        # Buscar todos os audit_logs de hoje em ordem REVERSA (do mais recente para o mais antigo)
        logs = conn.execute(text("""
            SELECT id, table_name, record_id, action, changes, created_at
            FROM audit_logs
            WHERE created_at >= '2026-07-31 00:00:00'
            ORDER BY id DESC
        """)).mappings().all()

        print(f"Total de ações registradas na auditoria de hoje a reverter: {len(logs)}\n")

        revertidos = 0
        erros = 0

        for l in logs:
            audit_id = l['id']
            table = l['table_name']
            rec_id = l['record_id']
            action = l['action']
            changes = l['changes']

            try:
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
                    conn.execute(text(f"""
                        UPDATE {table}
                        SET is_deleted = false, deleted_at = NULL, deleted_by_id = NULL
                        WHERE id = :rec_id
                    """), {'rec_id': rec_id})
                    revertidos += 1

                elif action in ('CREATE', 'INSERT'):
                    cols = conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}'")).scalars().all()
                    if 'is_deleted' in cols:
                        conn.execute(text(f"UPDATE {table} SET is_deleted = true WHERE id = :rec_id"), {'rec_id': rec_id})
                    else:
                        conn.execute(text(f"DELETE FROM {table} WHERE id = :rec_id"), {'rec_id': rec_id})
                    revertidos += 1

            except Exception as e:
                erros += 1

        conn.commit()

        print("\n==================================================================")
        print(f"✅ REVERSÃO CONCLUÍDA! Total de ações revertidas: {revertidos} | Erros: {erros}")
        print("==================================================================")

if __name__ == "__main__":
    reverter_auditoria_hoje()

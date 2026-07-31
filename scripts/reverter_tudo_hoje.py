"""
Script Sniper de Reversão Estrita Baseada em Logs de Auditoria para HOJE (2026-07-31)
Desfaz todas as alterações ocorridas hoje restaurando exatamente os valores 'old' dos audit logs.
"""
import os
os.environ["DISABLE_AUDIT"] = "1"

from sqlmodel import Session
from sqlalchemy import text
from app.db.session import engine

def executar_reversao_total_hoje():
    print("🎯 INICIANDO REVERSÃO TOTAL DE TODOS OS AUDIT LOGS REGISTRADOS HOJE (2026-07-31)")

    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = '300s';"))

        # Buscar todos os audit logs de hoje ordenados do mais recente para o mais antigo (DESC)
        logs = conn.execute(text("""
            SELECT id, table_name, record_id, action, changes, created_at, undone
            FROM audit_logs
            WHERE created_at >= '2026-07-31 00:00:00' AND undone = false
            ORDER BY id DESC
        """)).mappings().all()

        print(f"📋 Total de logs de auditoria a reverter: {len(logs)}")

        revertidos = 0
        erros = 0

        for log in logs:
            log_id = log['id']
            table_name = log['table_name']
            record_id = log['record_id']
            action = log['action']
            changes = log['changes'] or {}

            try:
                if action == 'UPDATE':
                    # Restaurar os valores 'old' para cada campo modificado
                    set_clauses = []
                    params = {'rid': record_id}
                    idx = 0

                    for field, diff in changes.items():
                        if isinstance(diff, dict) and 'old' in diff:
                            old_val = diff['old']
                            param_key = f"val_{idx}"
                            set_clauses.append(f"{field} = :{param_key}")
                            params[param_key] = old_val
                            idx += 1

                    if set_clauses:
                        sql = f"UPDATE {table_name} SET {', '.join(set_clauses)} WHERE id = :rid"
                        conn.execute(text(sql), params)
                        revertidos += 1

                elif action == 'CREATE':
                    # Para registros criados hoje, desativá-los
                    if table_name in ('lancamentos', 'baixas', 'movimentos', 'contas'):
                        sql = f"UPDATE {table_name} SET is_deleted = true, deleted_at = NOW() WHERE id = :rid"
                        conn.execute(text(sql), {'rid': record_id})
                        revertidos += 1

                elif action == 'SOFT_DELETE':
                    # Para registros desativados hoje, reativá-los
                    if table_name in ('lancamentos', 'baixas', 'movimentos', 'contas'):
                        sql = f"UPDATE {table_name} SET is_deleted = false, deleted_at = NULL WHERE id = :rid"
                        conn.execute(text(sql), {'rid': record_id})
                        revertidos += 1

                # Marcar log como desfeito
                conn.execute(text("UPDATE audit_logs SET undone = true WHERE id = :lid"), {'lid': log_id})

            except Exception as e:
                erros += 1
                print(f"⚠️ Erro ao reverter log {log_id} ({table_name} #{record_id}): {e}")

        conn.commit()
        print(f"\n✅ Reversão concluída! {revertidos} operações revertidas com sucesso | {erros} erros.")

if __name__ == '__main__':
    executar_reversao_total_hoje()

# scripts/delete_all_legacy_card_mirror_launches.py
import os
import sys

# Adiciona o diretório raiz ao path para que o Python localize a pasta 'app'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlmodel import Session
from app.db.session import engine
from sqlalchemy import text
from datetime import datetime

def main():
    dry_run = "--apply" not in sys.argv
    print("======================================================================")
    print("REMOÇÃO EM LOTE DOS LANÇAMENTOS ESPELHO DE CARTÃO (ORIGEM='PDV')")
    print(f"Modo: {'SIMULAÇÃO (dry-run)' if dry_run else 'APLICAR NO BANCO (COMMIT)'}")
    print("======================================================================")
    
    db = Session(engine)
    try:
        # 1. Obter os IDs das categorias de cartão (01.02 e 01.03) para todas as empresas
        categories = db.execute(text("""
            SELECT id FROM plano_contas 
            WHERE (codigo LIKE '01.02%' OR codigo LIKE '01.03%')
              AND is_deleted = false;
        """)).fetchall()
        
        cat_ids = [c[0] for c in categories]
        if not cat_ids:
            print("Nenhuma categoria de cartão (01.02 ou 01.03) ativa encontrada.")
            return
            
        print(f"Encontradas {len(cat_ids)} categorias de cartão.")
        
        # 2. Contar lançamentos por empresa
        breakdown = db.execute(text("""
            SELECT e.id, e.nome_fantasia, count(l.id) 
            FROM lancamentos l
            JOIN empresas e ON e.id = l.empresa_id
            WHERE l.origem = 'PDV'
              AND l.plano_contas_id IN :cat_ids
              AND l.is_deleted = false
            GROUP BY e.id, e.nome_fantasia;
        """), {"cat_ids": tuple(cat_ids)}).fetchall()
        
        print("\nDetalhamento dos lançamentos espelho por empresa:")
        total_count = 0
        for emp_id, emp_nome, count in breakdown:
            print(f"  - [{emp_id}] {emp_nome}: {count} lançamentos")
            total_count += count
            
        print(f"\nTotal geral de lançamentos espelho elegíveis: {total_count}")
        
        if dry_run:
            print("\n🔍 Modo SIMULAÇÃO finalizado. NENHUM DADO FOI ALTERADO.")
            print("Para executar a limpeza real no banco, rode:")
            print("  python scripts/delete_all_legacy_card_mirror_launches.py --apply")
            return
            
        # 3. Executar soft-delete em lotes para evitar lock/timeout
        now = datetime.utcnow()
        total_updated = 0
        while True:
            res = db.execute(text("""
                UPDATE lancamentos
                SET is_deleted = true,
                    deleted_at = :now,
                    updated_at = :now
                WHERE id IN (
                    SELECT id FROM lancamentos
                    WHERE origem = 'PDV'
                      AND plano_contas_id IN :cat_ids
                      AND is_deleted = false
                    LIMIT 5000
                );
            """), {"now": now, "cat_ids": tuple(cat_ids)})
            
            db.commit()
            rows = res.rowcount
            total_updated += rows
            print(f"Lote concluído: {rows} linhas atualizadas (Total acumulado: {total_updated}).")
            if rows == 0:
                break
                
        print(f"\n✅ Sucesso! {total_updated} lançamentos espelho de cartão foram desativados com sucesso!")
        
    except Exception as e:
        print(f"Erro durante remoção: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()


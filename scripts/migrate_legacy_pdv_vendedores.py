import sys
import argparse
from sqlmodel import Session, select, text
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.pdv_venda import PdvVenda
from app.core.cache import clear_transaction_cache

# Mapa de migração de IDs de vendedores: {ID_LEGADO: ID_ATIVO}
MIGRATION_MAP = {
    35: 458,  # Joel (joel@kyrus_legado.com -> joelmir.15rowdry@gmail.com)
    36: 31,   # Murillo (murillo@kyrus_legado.com -> murillosantos1@hotmail.com)
    37: 457,  # Erick (erick@kyrus_legado.com -> erikbmaia@gmail.com)
    48: 51,   # Vendedor Legado -> LOJA (loja@kyrustechlegado.com)
    49: 51,   # LOJA antigo -> LOJA principal
}

def migrate_legacy_vendedores(execute: bool = False):
    print("=" * 70)
    print(f" MIGRATION TOOL: VENDEDORES LEGADOS DO PDV ({'EXECUÇÃO REAL' if execute else 'SIMULAÇÃO / DRY-RUN'})")
    print("=" * 70)

    with Session(engine) as session:
        # 1. Garantir que o usuário LOJA (ID 51) esteja devidamente configurado
        loja_user = session.get(Usuario, 51)
        if loja_user:
            if hasattr(loja_user, "is_active") and not loja_user.is_active:
                loja_user.is_active = True
                session.add(loja_user)
                print("[Setup] Usuário LOJA (ID 51) ativado com sucesso.")

        # 2. Processar o mapeamento de migração
        total_vendas_migradas = 0
        empresas_afetadas = set()

        for source_id, target_id in MIGRATION_MAP.items():
            source_user = session.get(Usuario, source_id)
            target_user = session.get(Usuario, target_id)

            s_nome = source_user.nome if source_user else f"ID {source_id}"
            t_nome = target_user.nome if target_user else f"ID {target_id}"

            vendas = session.exec(
                select(PdvVenda).where(PdvVenda.vendedor_id == source_id)
            ).all()

            count = len(vendas)
            print(f"➜ De: {s_nome:25s} (ID {source_id:3d}) ➔ Para: {t_nome:25s} (ID {target_id:3d}) | Vendas: {count:6d}")

            if count > 0:
                for v in vendas:
                    if execute:
                        v.vendedor_id = target_id
                        session.add(v)
                    if v.empresa_id:
                        empresas_afetadas.add(v.empresa_id)
                total_vendas_migradas += count

        print("-" * 70)
        print(f"Total de vendas afetadas pela migração: {total_vendas_migradas}")
        print("-" * 70)

        if execute:
            session.commit()
            print("[Sucesso] Alterações gravadas no banco de dados com sucesso!")

            # Purga de cache para todas as empresas afetadas
            for emp_id in empresas_afetadas:
                clear_transaction_cache(emp_id, force=True)
            print(f"[Cache] Cache de transações purgado para {len(empresas_afetadas)} empresa(s).")
        else:
            print("[Modo Simulação] Nenhuma alteração foi gravada. Execute com --execute para aplicar.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migração de vendedores legados no PDV.")
    parser.add_argument("--execute", action="store_true", help="Aplica as alterações de fato no banco de dados.")
    args = parser.parse_args()

    migrate_legacy_vendedores(execute=args.execute)

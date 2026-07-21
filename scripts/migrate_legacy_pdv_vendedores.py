import sys
import argparse
from sqlmodel import Session, select
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.pdv_venda import PdvVenda
from app.models.lancamento import Lancamento
from app.models.empresa import Empresa
from app.core.cache import clear_transaction_cache

# Mapa de migração de IDs de vendedores: {ID_LEGADO: ID_ATIVO}
MIGRATION_MAP = {
    35: 458,  # Joel (joel@kyrus_legado.com -> joelmir.15rowdry@gmail.com)
    36: 31,   # Murillo (murillo@kyrus_legado.com -> murillosantos1@hotmail.com)
    37: 457,  # Erick (erick@kyrus_legado.com -> erikbmaia@gmail.com)
    38: 456,  # Danilo (danilo@kyrus_legado.com -> fernandesdan96@gmail.com / Dan Fernandes)
    48: 51,   # Vendedor Legado -> LOJA (loja@kyrustechlegado.com)
    49: 51,   # LOJA antigo -> LOJA principal
}

# Vendedores ativos mantidos (não devem ser inativados)
ACTIVE_SELLER_IDS = {
    34,   # Silas
    39,   # Guilherme (guilhermewanzeler239@gmail.com)
    44,   # Santa Maria
    45,   # Bragança
    51,   # LOJA
    31,   # Murillo
    456,  # Dan Fernandes (Danilo)
    457,  # Erik Maia
    458,  # Joel
}

# Vendedores legados a inativar no dropdown de usuários ativos
INACTIVE_SELLER_IDS = {
    35, 36, 37, 38, 40, 41, 42, 43, 46, 47, 48, 49
}

def migrate_legacy_vendedores(execute: bool = False):
    print("=" * 70)
    print(f" MIGRATION TOOL: VENDEDORES LEGADOS DO PDV ({'EXECUÇÃO REAL' if execute else 'SIMULAÇÃO / DRY-RUN'})")
    print("=" * 70)

    with Session(engine) as session:
        # 1. Ajustar status is_active dos usuários mantidos e inativados
        print("[Setup] Atualizando status is_active dos vendedores...")
        for uid in ACTIVE_SELLER_IDS:
            u = session.get(Usuario, uid)
            if u:
                if hasattr(u, "is_active") and not u.is_active:
                    print(f"  ➜ Ativando usuário: {u.nome} (ID {u.id})")
                    if execute:
                        u.is_active = True
                        session.add(u)

        for uid in INACTIVE_SELLER_IDS:
            u = session.get(Usuario, uid)
            if u:
                if hasattr(u, "is_active") and u.is_active:
                    print(f"  ➜ Inativando usuário legado: {u.nome} (ID {u.id})")
                    if execute:
                        u.is_active = False
                        session.add(u)

        # 2. Processar o mapeamento de migração de vendas
        total_vendas_migradas = 0
        empresas_afetadas = set()

        print("\n[Migração] Reatribuindo vendas do PDV...")
        for source_id, target_id in MIGRATION_MAP.items():
            source_user = session.get(Usuario, source_id)
            target_user = session.get(Usuario, target_id)

            s_nome = source_user.nome if source_user else f"ID {source_id}"
            t_nome = target_user.nome if target_user else f"ID {target_id}"

            vendas = session.exec(
                select(PdvVenda).where(PdvVenda.vendedor_id == source_id)
            ).all()

            launches = session.exec(
                select(Lancamento).where(Lancamento.created_by_id == source_id)
            ).all()

            count = len(vendas)
            l_count = len(launches)
            print(f"➜ De: {s_nome:25s} (ID {source_id:3d}) ➔ Para: {t_nome:25s} (ID {target_id:3d}) | Vendas: {count:6d} | Lançamentos: {l_count:6d}")

            if count > 0:
                for v in vendas:
                    if execute:
                        v.vendedor_id = target_id
                        session.add(v)
                    if v.empresa_id:
                        empresas_afetadas.add(v.empresa_id)
                total_vendas_migradas += count

            if l_count > 0:
                for l in launches:
                    if execute:
                        l.created_by_id = target_id
                        session.add(l)
                    if l.empresa_id:
                        empresas_afetadas.add(l.empresa_id)

        print("-" * 70)
        print(f"Total de vendas afetadas pela migração: {total_vendas_migradas}")
        print("-" * 70)

        # 3. Atualizar pdv_config das empresas para incluir 'Google' e 'Vendedor Externo'
        print("\n[Configurações] Atualizando canais de venda em pdv_config...")
        import json
        empresas = session.exec(select(Empresa)).all()
        for emp in empresas:
            if not emp.pdv_config:
                continue
            try:
                cfg = json.loads(emp.pdv_config)
                campos = cfg.get("campos_personalizados", [])
                updated = False
                for c in campos:
                    if c.get("id") == "canal_venda":
                        opts = c.get("options", [])
                        for target_opt in ["Google", "Vendedor Externo"]:
                            if target_opt not in opts:
                                opts.append(target_opt)
                                updated = True
                        c["options"] = opts
                if updated:
                    cfg["campos_personalizados"] = campos
                    print(f"  ➜ Atualizados canais de venda para Empresa ID {emp.id} ({emp.nome_fantasia or emp.razao_social})")
                    if execute:
                        emp.pdv_config = json.dumps(cfg)
                        session.add(emp)
                        empresas_afetadas.add(emp.id)
            except Exception as e:
                print(f"  ⚠ Erro ao atualizar pdv_config da empresa {emp.id}: {e}")

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

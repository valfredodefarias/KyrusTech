import sys
import argparse
import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.pdv_venda import PdvVenda
from app.models.lancamento import Lancamento
from app.models.empresa import Empresa
from app.core.cache import clear_transaction_cache

# Configuração dinâmica de busca de alvos por e-mail ou palavras-chave no nome
TARGET_CONFIG = {
    35: {"email": "joelmir.15rowdry@gmail.com", "keywords": ["joel"], "fallback_id": 458},
    36: {"email": "murillosantos1@hotmail.com", "keywords": ["murillo"], "fallback_id": 31},
    37: {"email": "erikbmaia@gmail.com", "keywords": ["erik", "erick"], "fallback_id": 457},
    38: {"email": "fernandesdan96@gmail.com", "keywords": ["dan", "danilo"], "fallback_id": 456},
    48: {"email": "loja@kyrustechlegado.com", "keywords": ["loja"], "fallback_id": 51},
    49: {"email": "loja@kyrustechlegado.com", "keywords": ["loja"], "fallback_id": 51},
}

# Usuários a inativar no dropdown
INACTIVE_EMAILS = [
    "joel@kyrus_legado.com", "murillo@kyrus_legado.com", "erick@kyrus_legado.com",
    "danilo@kyrus_legado.com", "adson@kyrus_legado.com", "breno@kyrus_legado.com",
    "christiano@kyrus_legado.com", "raphael@kyrus_legado.com", "william@kyrus_legado.com",
    "adriano@kyrus_legado.com"
]

def find_target_user(session: Session, cfg: dict) -> Usuario | None:
    # 1. Tentar por e-mail exato
    if cfg.get("email"):
        user = session.exec(select(Usuario).where(Usuario.email == cfg["email"])).first()
        if user:
            return user
    # 2. Tentar por palavras-chave no nome entre usuários ativos
    all_users = session.exec(select(Usuario)).all()
    for kw in cfg.get("keywords", []):
        for u in all_users:
            if kw in (u.nome or "").lower() and u.is_active:
                return u
    # 3. Fallback por ID se existir
    if cfg.get("fallback_id"):
        user = session.get(Usuario, cfg["fallback_id"])
        if user:
            return user
    return None

def migrate_legacy_vendedores(execute: bool = False):
    print("=" * 70)
    print(f" MIGRATION TOOL: VENDEDORES LEGADOS DO PDV ({'EXECUÇÃO REAL' if execute else 'SIMULAÇÃO / DRY-RUN'})")
    print("=" * 70)

    with Session(engine) as session:
        # 1. Inativar contas legadas duplicadas
        print("[Setup] Atualizando status de contas legadas...")
        for email in INACTIVE_EMAILS:
            u = session.exec(select(Usuario).where(Usuario.email == email)).first()
            if u and hasattr(u, "is_active") and u.is_active:
                print(f"  ➜ Inativando usuário legado duplicado: {u.nome} ({u.email})")
                if execute:
                    u.is_active = False
                    session.add(u)

        # 2. Processar o mapeamento dinâmico de migração de vendas e lançamentos
        total_vendas_migradas = 0
        empresas_afetadas = set()

        print("\n[Migração] Reatribuindo vendas do PDV e Lançamentos...")
        for source_id, cfg in TARGET_CONFIG.items():
            source_user = session.get(Usuario, source_id)
            target_user = find_target_user(session, cfg)

            if not target_user:
                print(f"  ⚠ ALERTA: Usuário alvo para o legado ID {source_id} não foi encontrado no banco!")
                continue

            target_id = target_user.id
            if execute and hasattr(target_user, "is_active") and not target_user.is_active:
                target_user.is_active = True
                session.add(target_user)

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
        empresas = session.exec(select(Empresa)).all()
        for emp in empresas:
            if not emp.pdv_config:
                continue
            try:
                cfg_data = json.loads(emp.pdv_config)
                campos = cfg_data.get("campos_personalizados", [])
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
                    cfg_data["campos_personalizados"] = campos
                    print(f"  ➜ Atualizados canais de venda para Empresa ID {emp.id} ({emp.nome_fantasia or emp.razao_social})")
                    if execute:
                        emp.pdv_config = json.dumps(cfg_data)
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

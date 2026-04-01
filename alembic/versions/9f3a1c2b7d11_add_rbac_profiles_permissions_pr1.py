"""add_rbac_profiles_permissions_pr1"""

from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f3a1c2b7d11'
down_revision: Union[str, None] = 'c5b1f8a3d2e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _permission_catalog() -> list[dict[str, object]]:
    return [
        {"code": "page:home:view", "module": "home", "action": "view", "description": "Acesso a pagina Home", "is_page_level": True},
        {"code": "page:boletim:view", "module": "boletim", "action": "view", "description": "Acesso a pagina Boletim", "is_page_level": True},
        {"code": "page:dre:view", "module": "dre", "action": "view", "description": "Acesso a pagina DRE", "is_page_level": True},
        {"code": "page:lancamentos:view", "module": "lancamentos", "action": "view", "description": "Acesso a pagina Lancamentos", "is_page_level": True},
        {"code": "page:contas:view", "module": "contas", "action": "view", "description": "Acesso a pagina Contas", "is_page_level": True},
        {"code": "page:cartoes:view", "module": "cartoes", "action": "view", "description": "Acesso a pagina Cartoes", "is_page_level": True},
        {"code": "page:entidades:view", "module": "entidades", "action": "view", "description": "Acesso a pagina Entidades", "is_page_level": True},
        {"code": "page:centro_custo:view", "module": "centro_custo", "action": "view", "description": "Acesso a pagina Centro de Custo", "is_page_level": True},
        {"code": "page:importacao:view", "module": "importacao", "action": "view", "description": "Acesso a pagina de Importacao", "is_page_level": True},
        {"code": "page:importacao_entidades:view", "module": "importacao_entidades", "action": "view", "description": "Acesso a pagina de Importacao de Entidades", "is_page_level": True},
        {"code": "page:importacao_ofx:view", "module": "importacao_ofx", "action": "view", "description": "Acesso a pagina de Importacao OFX", "is_page_level": True},
        {"code": "page:integracoes:view", "module": "integracoes", "action": "view", "description": "Acesso a pagina Integracoes", "is_page_level": True},
        {"code": "page:configuracoes:view", "module": "configuracoes", "action": "view", "description": "Acesso a pagina Configuracoes", "is_page_level": True},
        {"code": "page:consultor:view", "module": "consultor", "action": "view", "description": "Acesso a pagina Consultor", "is_page_level": True},
        {"code": "page:auditoria:view", "module": "auditoria", "action": "view", "description": "Acesso a pagina Auditoria", "is_page_level": True},
        {"code": "lancamentos:create", "module": "lancamentos", "action": "create", "description": "Criar lancamento", "is_page_level": False},
        {"code": "lancamentos:update", "module": "lancamentos", "action": "update", "description": "Atualizar lancamento", "is_page_level": False},
        {"code": "lancamentos:delete", "module": "lancamentos", "action": "delete", "description": "Excluir lancamento", "is_page_level": False},
        {"code": "lancamentos:bulk_pay", "module": "lancamentos", "action": "bulk_pay", "description": "Baixa em lote de lancamentos", "is_page_level": False},
        {"code": "lancamentos:bulk_delete", "module": "lancamentos", "action": "bulk_delete", "description": "Exclusao em lote de lancamentos", "is_page_level": False},
        {"code": "lancamentos:import", "module": "lancamentos", "action": "import", "description": "Importar lancamentos", "is_page_level": False},
        {"code": "lancamentos:transfer", "module": "lancamentos", "action": "transfer", "description": "Transferir entre contas", "is_page_level": False},
        {"code": "contas:create", "module": "contas", "action": "create", "description": "Criar conta", "is_page_level": False},
        {"code": "contas:update", "module": "contas", "action": "update", "description": "Atualizar conta", "is_page_level": False},
        {"code": "contas:delete", "module": "contas", "action": "delete", "description": "Excluir conta", "is_page_level": False},
        {"code": "cartoes:create", "module": "cartoes", "action": "create", "description": "Criar cartao", "is_page_level": False},
        {"code": "cartoes:update", "module": "cartoes", "action": "update", "description": "Atualizar cartao", "is_page_level": False},
        {"code": "cartoes:delete", "module": "cartoes", "action": "delete", "description": "Excluir cartao", "is_page_level": False},
        {"code": "cartoes:pay_invoice", "module": "cartoes", "action": "pay_invoice", "description": "Pagar fatura de cartao", "is_page_level": False},
        {"code": "entidades:create", "module": "entidades", "action": "create", "description": "Criar entidade", "is_page_level": False},
        {"code": "entidades:update", "module": "entidades", "action": "update", "description": "Atualizar entidade", "is_page_level": False},
        {"code": "entidades:delete", "module": "entidades", "action": "delete", "description": "Excluir entidade", "is_page_level": False},
        {"code": "entidades:import", "module": "entidades", "action": "import", "description": "Importar entidades", "is_page_level": False},
        {"code": "centro_custo:create", "module": "centro_custo", "action": "create", "description": "Criar centro de custo", "is_page_level": False},
        {"code": "centro_custo:update", "module": "centro_custo", "action": "update", "description": "Atualizar centro de custo", "is_page_level": False},
        {"code": "centro_custo:delete", "module": "centro_custo", "action": "delete", "description": "Excluir centro de custo", "is_page_level": False},
        {"code": "plano_contas:view", "module": "plano_contas", "action": "view", "description": "Visualizar plano de contas", "is_page_level": False},
        {"code": "plano_contas:create", "module": "plano_contas", "action": "create", "description": "Criar categoria no plano de contas", "is_page_level": False},
        {"code": "plano_contas:update", "module": "plano_contas", "action": "update", "description": "Atualizar categoria no plano de contas", "is_page_level": False},
        {"code": "plano_contas:delete", "module": "plano_contas", "action": "delete", "description": "Excluir categoria no plano de contas", "is_page_level": False},
        {"code": "plano_contas:reorder", "module": "plano_contas", "action": "reorder", "description": "Reordenar plano de contas", "is_page_level": False},
        {"code": "integracoes:view", "module": "integracoes", "action": "view", "description": "Visualizar integracoes", "is_page_level": False},
        {"code": "integracoes:create", "module": "integracoes", "action": "create", "description": "Criar integracao", "is_page_level": False},
        {"code": "integracoes:update", "module": "integracoes", "action": "update", "description": "Atualizar integracao", "is_page_level": False},
        {"code": "integracoes:delete", "module": "integracoes", "action": "delete", "description": "Excluir integracao", "is_page_level": False},
        {"code": "integracoes:sync", "module": "integracoes", "action": "sync", "description": "Sincronizar integracao", "is_page_level": False},
        {"code": "empresa:update", "module": "empresa", "action": "update", "description": "Atualizar dados da empresa", "is_page_level": False},
        {"code": "empresa:reset_base", "module": "empresa", "action": "reset_base", "description": "Resetar base financeira da empresa", "is_page_level": False},
        {"code": "usuarios:create", "module": "usuarios", "action": "create", "description": "Criar usuario", "is_page_level": False},
        {"code": "usuarios:update", "module": "usuarios", "action": "update", "description": "Atualizar usuario", "is_page_level": False},
        {"code": "usuarios:deactivate", "module": "usuarios", "action": "deactivate", "description": "Desativar usuario", "is_page_level": False},
        {"code": "usuarios:reset_password", "module": "usuarios", "action": "reset_password", "description": "Resetar senha de usuario", "is_page_level": False},
        {"code": "profiles:manage", "module": "profiles", "action": "manage", "description": "Gerenciar perfis e atribuicoes", "is_page_level": False},
        {"code": "auditoria:view", "module": "auditoria", "action": "view", "description": "Visualizar auditoria", "is_page_level": False},
    ]


def upgrade() -> None:
    op.create_table(
        "access_permissions",
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=120), nullable=False),
        sa.Column("module", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("is_page_level", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_access_permissions_code"),
    )
    op.create_index(op.f("ix_access_permissions_action"), "access_permissions", ["action"], unique=False)
    op.create_index(op.f("ix_access_permissions_is_active"), "access_permissions", ["is_active"], unique=False)
    op.create_index(op.f("ix_access_permissions_is_deleted"), "access_permissions", ["is_deleted"], unique=False)
    op.create_index(op.f("ix_access_permissions_is_page_level"), "access_permissions", ["is_page_level"], unique=False)
    op.create_index(op.f("ix_access_permissions_module"), "access_permissions", ["module"], unique=False)

    op.create_table(
        "access_profiles",
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("empresa_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_template", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("base_template_code", sa.String(length=80), nullable=True),
        sa.ForeignKeyConstraint(["empresa_id"], ["empresas.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("empresa_id", "code", name="uq_access_profiles_empresa_code"),
    )
    op.create_index(op.f("ix_access_profiles_code"), "access_profiles", ["code"], unique=False)
    op.create_index(op.f("ix_access_profiles_empresa_id"), "access_profiles", ["empresa_id"], unique=False)
    op.create_index(op.f("ix_access_profiles_is_active"), "access_profiles", ["is_active"], unique=False)
    op.create_index(op.f("ix_access_profiles_is_deleted"), "access_profiles", ["is_deleted"], unique=False)
    op.create_index(op.f("ix_access_profiles_is_system"), "access_profiles", ["is_system"], unique=False)
    op.create_index(op.f("ix_access_profiles_is_template"), "access_profiles", ["is_template"], unique=False)
    op.create_index(op.f("ix_access_profiles_name"), "access_profiles", ["name"], unique=False)

    op.create_table(
        "access_profile_permissions",
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("permission_id", sa.Integer(), nullable=False),
        sa.Column("allowed", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(["permission_id"], ["access_permissions.id"]),
        sa.ForeignKeyConstraint(["profile_id"], ["access_profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_id", "permission_id", name="uq_access_profile_permissions_profile_permission"),
    )
    op.create_index(op.f("ix_access_profile_permissions_is_deleted"), "access_profile_permissions", ["is_deleted"], unique=False)
    op.create_index(op.f("ix_access_profile_permissions_permission_id"), "access_profile_permissions", ["permission_id"], unique=False)
    op.create_index(op.f("ix_access_profile_permissions_profile_id"), "access_profile_permissions", ["profile_id"], unique=False)

    op.create_table(
        "user_company_profiles",
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("empresa_id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(["empresa_id"], ["empresas.id"]),
        sa.ForeignKeyConstraint(["profile_id"], ["access_profiles.id"]),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuarios.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("usuario_id", "empresa_id", name="uq_user_company_profiles_usuario_empresa"),
    )
    op.create_index(op.f("ix_user_company_profiles_empresa_id"), "user_company_profiles", ["empresa_id"], unique=False)
    op.create_index(op.f("ix_user_company_profiles_is_active"), "user_company_profiles", ["is_active"], unique=False)
    op.create_index(op.f("ix_user_company_profiles_is_deleted"), "user_company_profiles", ["is_deleted"], unique=False)
    op.create_index(op.f("ix_user_company_profiles_profile_id"), "user_company_profiles", ["profile_id"], unique=False)
    op.create_index(op.f("ix_user_company_profiles_usuario_id"), "user_company_profiles", ["usuario_id"], unique=False)

    permissions_table = sa.table(
        "access_permissions",
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
        sa.column("created_by_id", sa.Integer()),
        sa.column("updated_by_id", sa.Integer()),
        sa.column("is_deleted", sa.Boolean()),
        sa.column("deleted_at", sa.DateTime()),
        sa.column("deleted_by_id", sa.Integer()),
        sa.column("code", sa.String()),
        sa.column("module", sa.String()),
        sa.column("action", sa.String()),
        sa.column("description", sa.String()),
        sa.column("is_page_level", sa.Boolean()),
        sa.column("is_active", sa.Boolean()),
    )
    profiles_table = sa.table(
        "access_profiles",
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
        sa.column("created_by_id", sa.Integer()),
        sa.column("updated_by_id", sa.Integer()),
        sa.column("is_deleted", sa.Boolean()),
        sa.column("deleted_at", sa.DateTime()),
        sa.column("deleted_by_id", sa.Integer()),
        sa.column("empresa_id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("code", sa.String()),
        sa.column("description", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("is_system", sa.Boolean()),
        sa.column("is_template", sa.Boolean()),
        sa.column("base_template_code", sa.String()),
    )
    profile_permissions_table = sa.table(
        "access_profile_permissions",
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
        sa.column("created_by_id", sa.Integer()),
        sa.column("updated_by_id", sa.Integer()),
        sa.column("is_deleted", sa.Boolean()),
        sa.column("deleted_at", sa.DateTime()),
        sa.column("deleted_by_id", sa.Integer()),
        sa.column("profile_id", sa.Integer()),
        sa.column("permission_id", sa.Integer()),
        sa.column("allowed", sa.Boolean()),
    )

    now = datetime.utcnow()
    permission_rows = []
    for item in _permission_catalog():
        permission_rows.append(
            {
                "created_at": now,
                "updated_at": now,
                "created_by_id": None,
                "updated_by_id": None,
                "is_deleted": False,
                "deleted_at": None,
                "deleted_by_id": None,
                "code": item["code"],
                "module": item["module"],
                "action": item["action"],
                "description": item["description"],
                "is_page_level": item["is_page_level"],
                "is_active": True,
            }
        )
    op.bulk_insert(permissions_table, permission_rows)

    template_profiles = [
        {
            "created_at": now,
            "updated_at": now,
            "created_by_id": None,
            "updated_by_id": None,
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by_id": None,
            "empresa_id": None,
            "name": "Template - Acesso Completo",
            "code": "TEMPLATE_FULL_ACCESS",
            "description": "Template global com todas as permissoes",
            "is_active": True,
            "is_system": True,
            "is_template": True,
            "base_template_code": None,
        },
        {
            "created_at": now,
            "updated_at": now,
            "created_by_id": None,
            "updated_by_id": None,
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by_id": None,
            "empresa_id": None,
            "name": "Template - Financeiro",
            "code": "TEMPLATE_FINANCEIRO",
            "description": "Template para operacao financeira",
            "is_active": True,
            "is_system": True,
            "is_template": True,
            "base_template_code": None,
        },
        {
            "created_at": now,
            "updated_at": now,
            "created_by_id": None,
            "updated_by_id": None,
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by_id": None,
            "empresa_id": None,
            "name": "Template - Boletim",
            "code": "TEMPLATE_BOLETIM",
            "description": "Template para leitura de paineis financeiros",
            "is_active": True,
            "is_system": True,
            "is_template": True,
            "base_template_code": None,
        },
        {
            "created_at": now,
            "updated_at": now,
            "created_by_id": None,
            "updated_by_id": None,
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by_id": None,
            "empresa_id": None,
            "name": "Template - Home",
            "code": "TEMPLATE_HOME",
            "description": "Template minimo para acesso a Home",
            "is_active": True,
            "is_system": True,
            "is_template": True,
            "base_template_code": None,
        },
    ]
    op.bulk_insert(profiles_table, template_profiles)

    bind = op.get_bind()
    permission_map = {
        row.code: row.id
        for row in bind.execute(
            sa.text("SELECT id, code FROM access_permissions WHERE is_deleted = false")
        ).fetchall()
    }
    template_profile_map = {
        row.code: row.id
        for row in bind.execute(
            sa.text(
                "SELECT id, code FROM access_profiles "
                "WHERE empresa_id IS NULL AND is_template = true AND is_deleted = false"
            )
        ).fetchall()
    }

    finance_codes = {
        "page:home:view",
        "page:boletim:view",
        "page:dre:view",
        "page:lancamentos:view",
        "page:contas:view",
        "page:cartoes:view",
        "page:entidades:view",
        "page:centro_custo:view",
        "page:importacao:view",
        "page:importacao_entidades:view",
        "page:importacao_ofx:view",
        "lancamentos:create",
        "lancamentos:update",
        "lancamentos:delete",
        "lancamentos:bulk_pay",
        "lancamentos:bulk_delete",
        "lancamentos:import",
        "lancamentos:transfer",
        "contas:create",
        "contas:update",
        "contas:delete",
        "cartoes:create",
        "cartoes:update",
        "cartoes:delete",
        "cartoes:pay_invoice",
        "entidades:create",
        "entidades:update",
        "entidades:delete",
        "entidades:import",
        "centro_custo:create",
        "centro_custo:update",
        "centro_custo:delete",
        "plano_contas:view",
        "plano_contas:create",
        "plano_contas:update",
        "plano_contas:delete",
        "plano_contas:reorder",
        "integracoes:view",
        "integracoes:create",
        "integracoes:update",
        "integracoes:delete",
        "integracoes:sync",
        "empresa:update",
        "usuarios:create",
        "usuarios:update",
    }
    boletim_codes = {"page:home:view", "page:boletim:view", "page:dre:view", "auditoria:view"}
    home_codes = {"page:home:view"}

    template_to_codes = {
        "TEMPLATE_FULL_ACCESS": set(permission_map.keys()),
        "TEMPLATE_FINANCEIRO": finance_codes,
        "TEMPLATE_BOLETIM": boletim_codes,
        "TEMPLATE_HOME": home_codes,
    }

    profile_permission_rows = []
    for template_code, permission_codes in template_to_codes.items():
        profile_id = template_profile_map.get(template_code)
        if not profile_id:
            continue
        for permission_code in permission_codes:
            permission_id = permission_map.get(permission_code)
            if not permission_id:
                continue
            profile_permission_rows.append(
                {
                    "created_at": now,
                    "updated_at": now,
                    "created_by_id": None,
                    "updated_by_id": None,
                    "is_deleted": False,
                    "deleted_at": None,
                    "deleted_by_id": None,
                    "profile_id": profile_id,
                    "permission_id": permission_id,
                    "allowed": True,
                }
            )
    op.bulk_insert(profile_permissions_table, profile_permission_rows)

    op.execute(
        sa.text(
            """
            INSERT INTO access_profiles (
                empresa_id,
                name,
                code,
                description,
                is_active,
                is_system,
                is_template,
                base_template_code,
                created_at,
                updated_at,
                is_deleted
            )
            SELECT
                e.id,
                'Acesso Completo',
                'FULL_ACCESS',
                'Perfil inicial criado automaticamente pela migracao RBAC',
                true,
                true,
                false,
                'TEMPLATE_FULL_ACCESS',
                NOW(),
                NOW(),
                false
            FROM empresas e
            WHERE COALESCE(e.is_deleted, false) = false
              AND NOT EXISTS (
                SELECT 1
                FROM access_profiles p
                WHERE p.empresa_id = e.id
                  AND p.code = 'FULL_ACCESS'
                  AND COALESCE(p.is_deleted, false) = false
              )
            """
        )
    )

    op.execute(
        sa.text(
            """
            INSERT INTO access_profile_permissions (
                profile_id,
                permission_id,
                allowed,
                created_at,
                updated_at,
                is_deleted
            )
            SELECT
                company_profile.id,
                tpl_link.permission_id,
                true,
                NOW(),
                NOW(),
                false
            FROM access_profiles company_profile
            JOIN access_profiles tpl_profile
              ON tpl_profile.code = 'TEMPLATE_FULL_ACCESS'
             AND tpl_profile.empresa_id IS NULL
             AND COALESCE(tpl_profile.is_deleted, false) = false
            JOIN access_profile_permissions tpl_link
              ON tpl_link.profile_id = tpl_profile.id
             AND COALESCE(tpl_link.is_deleted, false) = false
             AND tpl_link.allowed = true
            LEFT JOIN access_profile_permissions existing_link
              ON existing_link.profile_id = company_profile.id
             AND existing_link.permission_id = tpl_link.permission_id
             AND COALESCE(existing_link.is_deleted, false) = false
            WHERE company_profile.code = 'FULL_ACCESS'
              AND company_profile.empresa_id IS NOT NULL
              AND COALESCE(company_profile.is_deleted, false) = false
              AND existing_link.id IS NULL
            """
        )
    )

    op.execute(
        sa.text(
            """
            INSERT INTO user_company_profiles (
                usuario_id,
                empresa_id,
                profile_id,
                is_active,
                created_at,
                updated_at,
                is_deleted
            )
            SELECT
                u.id,
                u.empresa_id,
                p.id,
                true,
                NOW(),
                NOW(),
                false
            FROM usuarios u
            JOIN access_profiles p
              ON p.empresa_id = u.empresa_id
             AND p.code = 'FULL_ACCESS'
             AND COALESCE(p.is_deleted, false) = false
            LEFT JOIN user_company_profiles cp
              ON cp.usuario_id = u.id
             AND cp.empresa_id = u.empresa_id
             AND COALESCE(cp.is_deleted, false) = false
            WHERE u.empresa_id IS NOT NULL
              AND COALESCE(u.is_deleted, false) = false
              AND cp.id IS NULL
            """
        )
    )

    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF to_regclass('public.consultor_empresa') IS NOT NULL THEN
                    INSERT INTO user_company_profiles (
                        usuario_id,
                        empresa_id,
                        profile_id,
                        is_active,
                        created_at,
                        updated_at,
                        is_deleted
                    )
                    SELECT
                        ce.usuario_id,
                        ce.empresa_id,
                        p.id,
                        true,
                        NOW(),
                        NOW(),
                        false
                    FROM consultor_empresa ce
                    JOIN usuarios u
                      ON u.id = ce.usuario_id
                     AND COALESCE(u.is_deleted, false) = false
                    JOIN access_profiles p
                      ON p.empresa_id = ce.empresa_id
                     AND p.code = 'FULL_ACCESS'
                     AND COALESCE(p.is_deleted, false) = false
                    LEFT JOIN user_company_profiles cp
                      ON cp.usuario_id = ce.usuario_id
                     AND cp.empresa_id = ce.empresa_id
                     AND COALESCE(cp.is_deleted, false) = false
                    WHERE ce.ativo = true
                      AND cp.id IS NULL;
                END IF;
            END $$;
            """
        )
    )


def downgrade() -> None:
    op.drop_table("user_company_profiles")
    op.drop_table("access_profile_permissions")
    op.drop_table("access_profiles")
    op.drop_table("access_permissions")
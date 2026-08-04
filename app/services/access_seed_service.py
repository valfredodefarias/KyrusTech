from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.enums import PdvPermission
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.consultor_empresa import ConsultorEmpresa
from app.models.empresa import Empresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.usuario import Usuario

PERMISSION_CATALOG: list[dict[str, Any]] = [
    {"code": "page:home:view", "module": "home", "action": "view", "description": "Acesso a pagina Home", "is_page_level": True},
    {"code": "page:boletim:view", "module": "boletim", "action": "view", "description": "Acesso a pagina Boletim", "is_page_level": True},
    {"code": "page:dre:view", "module": "dre", "action": "view", "description": "Acesso a pagina DRE", "is_page_level": True},
    {"code": "page:lancamentos:view", "module": "lancamentos", "action": "view", "description": "Acesso a pagina Lancamentos", "is_page_level": True},
    {"code": "page:contas:view", "module": "contas", "action": "view", "description": "Acesso a pagina Contas", "is_page_level": True},
    {"code": "page:cartoes:view", "module": "cartoes", "action": "view", "description": "Acesso a pagina Cartoes", "is_page_level": True},
    {"code": "page:caixa:view", "module": "caixa", "action": "view", "description": "Acesso a pagina Caixa", "is_page_level": True},
    {"code": "page:entidades:view", "module": "entidades", "action": "view", "description": "Acesso a pagina Entidades", "is_page_level": True},
    {"code": "page:centro_custo:view", "module": "centro_custo", "action": "view", "description": "Acesso a pagina Centro de Custo", "is_page_level": True},
    {"code": "page:importacao:view", "module": "importacao", "action": "view", "description": "Acesso a pagina de Importacao", "is_page_level": True},
    {"code": "page:importacao_entidades:view", "module": "importacao_entidades", "action": "view", "description": "Acesso a pagina de Importacao de Entidades", "is_page_level": True},
    {"code": "page:importacao_ofx:view", "module": "importacao_ofx", "action": "view", "description": "Acesso a pagina de Importacao OFX", "is_page_level": True},
    {"code": "page:importacao_nfe:view", "module": "importacao_nfe", "action": "view", "description": "Acesso a pagina de Importacao XML NF-e", "is_page_level": True},
    {"code": "page:integracoes:view", "module": "integracoes", "action": "view", "description": "Acesso a pagina Integracoes", "is_page_level": True},
    {"code": "page:configuracoes:view", "module": "configuracoes", "action": "view", "description": "Acesso a pagina Configuracoes", "is_page_level": True},
    {"code": "page:ifood:view", "module": "ifood", "action": "view", "description": "Acesso a pagina do iFood PDV", "is_page_level": True},
    {"code": "page:consultor:view", "module": "consultor", "action": "view", "description": "Acesso a pagina Consultor", "is_page_level": True},
    {"code": "page:auditoria:view", "module": "auditoria", "action": "view", "description": "Acesso a pagina Auditoria", "is_page_level": True},
    {"code": "lancamentos:create", "module": "lancamentos", "action": "create", "description": "Criar lancamento", "is_page_level": False},
    {"code": "lancamentos:update", "module": "lancamentos", "action": "update", "description": "Atualizar lancamento", "is_page_level": False},
    {"code": "lancamentos:delete", "module": "lancamentos", "action": "delete", "description": "Excluir lancamento", "is_page_level": False},
    {"code": "lancamentos:bulk_pay", "module": "lancamentos", "action": "bulk_pay", "description": "Baixa em lote de lancamentos", "is_page_level": False},
    {"code": "lancamentos:bulk_delete", "module": "lancamentos", "action": "bulk_delete", "description": "Exclusao em lote de lancamentos", "is_page_level": False},
    {"code": "lancamentos:import", "module": "lancamentos", "action": "import", "description": "Importar lancamentos", "is_page_level": False},
    {"code": "lancamentos:import_nfe", "module": "lancamentos", "action": "import_nfe", "description": "Importar lancamentos via XML NF-e", "is_page_level": False},
    {"code": "lancamentos:transfer", "module": "lancamentos", "action": "transfer", "description": "Transferir entre contas", "is_page_level": False},
    {"code": PdvPermission.PDV_VER_TODAS_VENDAS.value, "module": "pdv", "action": "view_all_sales", "description": "Ver faturamento geral do caixa", "is_page_level": False},
    {"code": PdvPermission.PDV_SER_VENDEDOR.value, "module": "pdv", "action": "seller", "description": "Permitir que o usuário apareça como vendedor no PDV", "is_page_level": False},
    {"code": PdvPermission.PDV_REALIZAR_SANGRIA.value, "module": "pdv", "action": "cash_withdrawal", "description": "Realizar sangria no caixa", "is_page_level": False},
    {"code": PdvPermission.PDV_CANCELAR_VENDA.value, "module": "pdv", "action": "cancel_sale", "description": "Cancelar ou estornar venda", "is_page_level": False},
    {"code": PdvPermission.PDV_CONCEDER_DESCONTO.value, "module": "pdv", "action": "grant_discount", "description": "Conceder desconto na venda", "is_page_level": False},
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

TEMPLATE_PROFILE_CODES: dict[str, dict[str, Any]] = {
    "TEMPLATE_FULL_ACCESS": {
        "name": "Template - Acesso Completo",
        "description": "Template global com todas as permissoes",
    },
    "TEMPLATE_FINANCEIRO": {
        "name": "Template - Financeiro",
        "description": "Template para operacao financeira",
    },
    "TEMPLATE_BOLETIM": {
        "name": "Template - Boletim",
        "description": "Template para leitura de paineis financeiros",
    },
    "TEMPLATE_HOME": {
        "name": "Template - Home",
        "description": "Template minimo para acesso a Home",
    },
    "TEMPLATE_VENDEDOR": {
        "name": "Template - Vendedor",
        "description": "Template para vendedores com acesso ao PDV e metas",
    },
    "TEMPLATE_AUDITOR": {
        "name": "Template - Auditor",
        "description": "Template com acesso total de leitura (Read-only)",
    },
}


def _template_permission_codes() -> dict[str, set[str]]:
    finance_codes = {
        "page:home:view",
        "page:boletim:view",
        "page:dre:view",
        "page:lancamentos:view",
        "page:contas:view",
        "page:cartoes:view",
        "page:caixa:view",
        "page:entidades:view",
        "page:centro_custo:view",
        "page:importacao:view",
        "page:importacao_entidades:view",
        "page:importacao_ofx:view",
        "page:importacao_nfe:view",
        "page:ifood:view",
        "lancamentos:create",
        "lancamentos:update",
        "lancamentos:delete",
        "lancamentos:bulk_pay",
        "lancamentos:bulk_delete",
        "lancamentos:import",
        "lancamentos:import_nfe",
        "lancamentos:transfer",
        PdvPermission.PDV_VER_TODAS_VENDAS.value,
        PdvPermission.PDV_SER_VENDEDOR.value,
        PdvPermission.PDV_REALIZAR_SANGRIA.value,
        PdvPermission.PDV_CANCELAR_VENDA.value,
        PdvPermission.PDV_CONCEDER_DESCONTO.value,
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
    vendedor_codes = {"page:home:view", "page:caixa:view", PdvPermission.PDV_SER_VENDEDOR.value}
    auditor_codes = {
        "page:home:view",
        "page:boletim:view",
        "page:dre:view",
        "page:lancamentos:view",
        "page:contas:view",
        "page:cartoes:view",
        "page:caixa:view",
        "page:entidades:view",
        "page:centro_custo:view",
        "page:importacao:view",
        "page:importacao_entidades:view",
        "page:importacao_ofx:view",
        "page:importacao_nfe:view",
        "page:ifood:view",
        "page:configuracoes:view",
        "page:auditoria:view",
        "plano_contas:view",
        "integracoes:view",
        "auditoria:view"
    }

    return {
        "TEMPLATE_FULL_ACCESS": {item["code"] for item in PERMISSION_CATALOG if item["code"] != "empresa:reset_base"},
        "TEMPLATE_FINANCEIRO": finance_codes,
        "TEMPLATE_BOLETIM": boletim_codes,
        "TEMPLATE_HOME": home_codes,
        "TEMPLATE_VENDEDOR": vendedor_codes,
        "TEMPLATE_AUDITOR": auditor_codes,
    }


def ensure_rbac_seed(db: Session) -> dict[str, int]:
    now = datetime.utcnow()
    stats = {
        "permissions_created": 0,
        "templates_created": 0,
        "template_links_created": 0,
        "company_profiles_created": 0,
        "user_assignments_created": 0,
    }

    existing_permissions = {
        item.code: item
        for item in db.exec(select(AccessPermission).where(AccessPermission.is_deleted == False)).all()
    }

    for row in PERMISSION_CATALOG:
        code = str(row["code"])
        permission = existing_permissions.get(code)
        if permission:
            permission.module = str(row["module"])
            permission.action = str(row["action"])
            permission.description = str(row["description"])
            permission.is_page_level = bool(row["is_page_level"])
            permission.is_active = True
            permission.is_deleted = False
            permission.updated_at = now
            db.add(permission)
            continue

        db.add(
            AccessPermission.model_validate(
                {
                    "code": code,
                    "module": str(row["module"]),
                    "action": str(row["action"]),
                    "description": str(row["description"]),
                    "is_page_level": bool(row["is_page_level"]),
                    "is_active": True,
                    "created_at": now,
                    "updated_at": now,
                    "is_deleted": False,
                }
            )
        )
        stats["permissions_created"] += 1

    db.commit()

    templates_by_code = {
        item.code: item
        for item in db.exec(
            select(AccessProfile).where(
                AccessProfile.empresa_id == None,
                AccessProfile.is_template == True,
                AccessProfile.is_deleted == False,
            )
        ).all()
    }

    for code, metadata in TEMPLATE_PROFILE_CODES.items():
        template = templates_by_code.get(code)
        if template:
            template.name = str(metadata["name"])
            template.description = str(metadata["description"])
            template.is_system = True
            template.is_template = True
            template.is_active = True
            template.updated_at = now
            template.is_deleted = False
            db.add(template)
            continue

        db.add(
            AccessProfile.model_validate(
                {
                    "empresa_id": None,
                    "name": str(metadata["name"]),
                    "code": code,
                    "description": str(metadata["description"]),
                    "is_active": True,
                    "is_system": True,
                    "is_template": True,
                    "base_template_code": None,
                    "created_at": now,
                    "updated_at": now,
                    "is_deleted": False,
                }
            )
        )
        stats["templates_created"] += 1

    db.commit()

    permissions_map = {
        item.code: item
        for item in db.exec(select(AccessPermission).where(AccessPermission.is_deleted == False)).all()
    }
    templates_by_code = {
        item.code: item
        for item in db.exec(
            select(AccessProfile).where(
                AccessProfile.empresa_id == None,
                AccessProfile.is_template == True,
                AccessProfile.is_deleted == False,
            )
        ).all()
    }

    template_links = db.exec(
        select(AccessProfilePermission).where(AccessProfilePermission.is_deleted == False)
    ).all()
    existing_link_keys = {(link.profile_id, link.permission_id): link for link in template_links}

    for template_code, permission_codes in _template_permission_codes().items():
        template = templates_by_code.get(template_code)
        if not template or template.id is None:
            continue

        for permission_code in permission_codes:
            permission = permissions_map.get(permission_code)
            if not permission or permission.id is None:
                continue

            key = (int(template.id), int(permission.id))
            link = existing_link_keys.get(key)
            if link:
                if not link.allowed or link.is_deleted:
                    link.allowed = True
                    link.is_deleted = False
                    link.updated_at = now
                    db.add(link)
                continue

            db.add(
                AccessProfilePermission.model_validate(
                    {
                        "profile_id": int(template.id),
                        "permission_id": int(permission.id),
                        "allowed": True,
                        "created_at": now,
                        "updated_at": now,
                        "is_deleted": False,
                    }
                )
            )
            stats["template_links_created"] += 1

    db.commit()

    full_template = templates_by_code.get("TEMPLATE_FULL_ACCESS")
    if not full_template or full_template.id is None:
        return stats

    full_template_links = db.exec(
        select(AccessProfilePermission).where(
            AccessProfilePermission.profile_id == int(full_template.id),
            AccessProfilePermission.is_deleted == False,
            AccessProfilePermission.allowed == True,
        )
    ).all()

    full_permission_ids = [int(link.permission_id) for link in full_template_links if link.permission_id is not None]

    companies = db.exec(select(Empresa).where(Empresa.is_deleted == False)).all()
    company_full_profiles: dict[int, AccessProfile] = {}

    for company in companies:
        if company.id is None:
            continue
        profile = db.exec(
            select(AccessProfile).where(
                AccessProfile.empresa_id == int(company.id),
                AccessProfile.code == "FULL_ACCESS",
                AccessProfile.is_deleted == False,
            )
        ).first()

        if not profile:
            profile = AccessProfile(
                empresa_id=int(company.id),
                name="Administrador",
                code="FULL_ACCESS",
                description="Perfil padrão administrador criado automaticamente",
                is_active=True,
                is_system=True,
                is_template=False,
                base_template_code="TEMPLATE_FULL_ACCESS",
                created_at=now,
                updated_at=now,
                is_deleted=False,
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
            stats["company_profiles_created"] += 1
        else:
            profile.name = "Administrador"
            profile.description = profile.description or "Perfil padrão administrador criado automaticamente"
            profile.is_system = True
            profile.is_template = False
            profile.is_active = True
            profile.base_template_code = "TEMPLATE_FULL_ACCESS"
            profile.updated_at = now
            profile.is_deleted = False
            db.add(profile)

        company_full_profiles[int(company.id)] = profile

    company_profile_links = db.exec(
        select(AccessProfilePermission).where(AccessProfilePermission.is_deleted == False)
    ).all()
    company_link_keys = {(int(link.profile_id), int(link.permission_id)) for link in company_profile_links}

    for company_id, profile in company_full_profiles.items():
        if profile.id is None:
            continue
        for permission_id in full_permission_ids:
            key = (int(profile.id), int(permission_id))
            if key in company_link_keys:
                continue
            db.add(
                AccessProfilePermission.model_validate(
                    {
                        "profile_id": int(profile.id),
                        "permission_id": int(permission_id),
                        "allowed": True,
                        "created_at": now,
                        "updated_at": now,
                        "is_deleted": False,
                    }
                )
            )
            company_link_keys.add(key)
            stats["template_links_created"] += 1

    db.commit()

    # Provisionar perfil Vendedor nas empresas
    vendedor_template = templates_by_code.get("TEMPLATE_VENDEDOR")
    if vendedor_template and vendedor_template.id is not None:
        vendedor_template_links = db.exec(
            select(AccessProfilePermission).where(
                AccessProfilePermission.profile_id == int(vendedor_template.id),
                AccessProfilePermission.is_deleted == False,
                AccessProfilePermission.allowed == True,
            )
        ).all()
        vendedor_permission_ids = [int(link.permission_id) for link in vendedor_template_links if link.permission_id is not None]
        
        for company in companies:
            if company.id is None:
                continue
            v_profile = db.exec(
                select(AccessProfile).where(
                    AccessProfile.empresa_id == int(company.id),
                    AccessProfile.code == "VENDEDOR",
                    AccessProfile.is_deleted == False,
                )
            ).first()
            if not v_profile:
                v_profile = AccessProfile(
                    empresa_id=int(company.id),
                    name="Vendedor",
                    code="VENDEDOR",
                    description="Perfil padrão vendedor criado automaticamente com acesso ao PDV e metas",
                    is_active=True,
                    is_system=True,
                    is_template=False,
                    base_template_code="TEMPLATE_VENDEDOR",
                    created_at=now,
                    updated_at=now,
                    is_deleted=False,
                )
                db.add(v_profile)
                db.commit()
                db.refresh(v_profile)
                stats["company_profiles_created"] += 1
            else:
                v_profile.name = "Vendedor"
                v_profile.description = v_profile.description or "Perfil padrão vendedor criado automaticamente com acesso ao PDV e metas"
                v_profile.is_system = True
                v_profile.is_template = False
                v_profile.is_active = True
                v_profile.base_template_code = "TEMPLATE_VENDEDOR"
                v_profile.updated_at = now
                v_profile.is_deleted = False
                db.add(v_profile)

            for permission_id in vendedor_permission_ids:
                key = (int(v_profile.id), int(permission_id))
                if key in company_link_keys:
                    continue
                db.add(
                    AccessProfilePermission.model_validate(
                        {
                            "profile_id": int(v_profile.id),
                            "permission_id": int(permission_id),
                            "allowed": True,
                            "created_at": now,
                            "updated_at": now,
                            "is_deleted": False,
                        }
                    )
                )
                company_link_keys.add(key)
                stats["template_links_created"] += 1
        db.commit()

    existing_assignments = {
        (int(item.usuario_id), int(item.empresa_id)): item
        for item in db.exec(select(UserCompanyProfile).where(UserCompanyProfile.is_deleted == False)).all()
        if item.usuario_id is not None and item.empresa_id is not None
    }

    consultor_links = db.exec(
        select(ConsultorEmpresa).where(ConsultorEmpresa.ativo == True)
    ).all()
    consultor_empresas_map: dict[int, set[int]] = {}
    for link in consultor_links:
        consultor_empresas_map.setdefault(int(link.usuario_id), set()).add(int(link.empresa_id))

    users = db.exec(select(Usuario).where(Usuario.is_deleted == False)).all()

    for user in users:
        if user.id is None:
            continue

        target_company_ids: set[int] = set()
        if user.empresa_id is not None:
            target_company_ids.add(int(user.empresa_id))
        target_company_ids.update(consultor_empresas_map.get(int(user.id), set()))

        for company_id in target_company_ids:
            company_profile = company_full_profiles.get(company_id)
            if not company_profile or company_profile.id is None:
                continue

            key = (int(user.id), int(company_id))
            existing = existing_assignments.get(key)
            if existing:
                if not existing.is_active or existing.is_deleted:
                    existing.is_active = True
                    existing.is_deleted = False
                    existing.updated_at = now
                    db.add(existing)
                continue

            db.add(
                UserCompanyProfile.model_validate(
                    {
                        "usuario_id": int(user.id),
                        "empresa_id": int(company_id),
                        "profile_id": int(company_profile.id),
                        "is_active": True,
                        "created_at": now,
                        "updated_at": now,
                        "is_deleted": False,
                    }
                )
            )
            stats["user_assignments_created"] += 1

    # Desativa/exclui qualquer associacao existente da permissao 'empresa:reset_base' em qualquer perfil
    reset_perm = db.exec(
        select(AccessPermission).where(
            AccessPermission.code == "empresa:reset_base",
            AccessPermission.is_deleted == False
        )
    ).first()
    if reset_perm and reset_perm.id is not None:
        existing_reset_links = db.exec(
            select(AccessProfilePermission).where(
                AccessProfilePermission.permission_id == int(reset_perm.id),
                AccessProfilePermission.is_deleted == False
            )
        ).all()
        for link in existing_reset_links:
            link.allowed = False
            link.is_deleted = True
            db.add(link)

    db.commit()
    return stats

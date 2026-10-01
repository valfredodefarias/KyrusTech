"""
Endpoints exclusivos para consultores internos.
Super consultores têm acesso global; consultores comuns operam apenas nas empresas autorizadas.
Todas as operações são logadas para auditoria e segurança.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from loguru import logger
from typing import List, Optional

from app.db.session import get_db
from app.models.empresa import Empresa
from app.models.plano_contas import PlanoContas
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa
from app.api.v1.deps import get_consultor_user, get_current_active_user, get_super_consultor_user
from app.schemas.empresa import EmpresaRead
from app.schemas.plano_contas import PlanoContasCreate, PlanoContasRead, PlanoContasUpdate
from app.enums import ConsultorRole
from app.core.security import get_password_hash
from app.crud import crud_plano_contas, crud_auto_adjustment_config
from app.crud.crud_consultor_empresa import tem_acesso
from pydantic import BaseModel

router = APIRouter()


def _is_super_consultor(user: Usuario) -> bool:
    return user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value


def _get_consultor_empresa_ids(db: Session, consultor_id: int) -> list[int]:
    return list(
        db.exec(
            select(ConsultorEmpresa.empresa_id).where(
                ConsultorEmpresa.usuario_id == consultor_id,
                ConsultorEmpresa.ativo == True,
            )
        ).all()
    )


def _resolve_empresa_contexto(db: Session, consultor: Usuario) -> Empresa:
    empresa_id = consultor.empresa_id

    if empresa_id and (_is_super_consultor(consultor) or tem_acesso(db, int(consultor.id), empresa_id)):
        empresa = db.get(Empresa, empresa_id)
        if empresa and not empresa.is_deleted and empresa.is_active:
            return empresa

    if _is_super_consultor(consultor):
        empresa = db.exec(
            select(Empresa)
            .where(Empresa.is_deleted == False, Empresa.is_active == True)
            .order_by(Empresa.id)
        ).first()
    else:
        empresa_ids = _get_consultor_empresa_ids(db, int(consultor.id))
        empresa = None
        if empresa_ids:
            empresa = db.exec(
                select(Empresa)
                .where(
                    Empresa.id.in_(empresa_ids),
                    Empresa.is_deleted == False,
                    Empresa.is_active == True,
                )
                .order_by(Empresa.id)
            ).first()

    if not empresa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa do contexto não encontrada"
        )

    if consultor.empresa_id != empresa.id:
        consultor.empresa_id = empresa.id
        db.add(consultor)
        db.commit()
        db.refresh(consultor)

    return empresa


def _mask_email(value: Optional[str]) -> Optional[str]:
    if not value or "@" not in value:
        return value
    local, domain = value.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "*" * max(0, len(local) - 1)
    else:
        masked_local = local[:2] + "*" * max(1, len(local) - 2)
    return f"{masked_local}@{domain}"


def _normalizar_tipo_pessoa_template(tipo_pessoa: str) -> str:
    valor = (tipo_pessoa or "").strip().upper()
    if valor not in {"PF", "PJ"}:
        raise HTTPException(status_code=400, detail="tipo_pessoa invalido. Use PF ou PJ")
    return valor


def _template_items_index(items: List[dict]) -> dict[int, dict]:
    return {int(item["id"]): item for item in items}


def _template_descendants(items_index: dict[int, dict], node_id: int) -> set[int]:
    descendants: set[int] = set()
    for current_id, item in items_index.items():
        if item.get("conta_pai_id") == node_id:
            descendants.add(current_id)
            descendants.update(_template_descendants(items_index, current_id))
    return descendants


def _assert_seed_template_manager(user: Usuario) -> None:
    if _is_super_consultor(user) or crud_plano_contas.can_manage_operational_flag(user.email, getattr(user, "consultor_role", None)):
        return
    raise HTTPException(status_code=403, detail="Sem permissao para gerenciar o template global do plano de contas")


class RoleChangeRequest(BaseModel):
    """Schema para mudança de role"""
    role: str


class EmpresaContexto(BaseModel):
    """Schema para troca de contexto de empresa"""
    empresa_id: int


class ResetPasswordRequest(BaseModel):
    """Schema para redefinição de senha"""
    new_password: str


class PlanoContasTemplateReordenacaoItem(BaseModel):
    id: int
    codigo: str
    conta_pai_id: Optional[int] = None
    tipo: str


class AutoAdjustmentConfigWrite(BaseModel):
    juros_multa_template_id: Optional[int] = None
    descontos_template_id: Optional[int] = None


class AutoAdjustmentConfigRead(BaseModel):
    tipo_pessoa: str
    juros_multa_template_id: Optional[int] = None
    descontos_template_id: Optional[int] = None
    juros_multa_categoria_nome: str
    descontos_categoria_nome: str
    juros_multa_tipo: str
    descontos_tipo: str
    juros_multa_dre_grupo: str
    descontos_dre_grupo: str


class AutoAdjustmentEmpresaConfigWrite(BaseModel):
    juros_multa_plano_contas_id: Optional[int] = None
    descontos_plano_contas_id: Optional[int] = None


class AutoAdjustmentEmpresaConfigRead(BaseModel):
    empresa_id: int
    tipo_pessoa: str
    juros_multa_plano_contas_id: Optional[int] = None
    descontos_plano_contas_id: Optional[int] = None
    juros_multa_categoria_nome: str
    descontos_categoria_nome: str
    juros_multa_tipo: str
    descontos_tipo: str
    juros_multa_dre_grupo: str
    descontos_dre_grupo: str


class EmpresaPlanoContasOptionRead(BaseModel):
    id: int
    nome: str
    tipo: str
    dre_grupo: str
    conta_pai_id: Optional[int] = None


@router.get("/empresas", response_model=List[EmpresaRead])
def listar_todas_empresas(
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Lista todas as empresas do sistema.
    Apenas consultores têm acesso a esta funcionalidade.
    Todas as consultas são logadas para auditoria.
    """
    logger.info(
        f"[CONSULTOR] Usuario {consultor.email} (ID: {consultor.id}) listou todas as empresas"
    )
    
    try:
        query = select(Empresa).where(Empresa.is_deleted == False)
        if not _is_super_consultor(consultor):
            empresa_ids = _get_consultor_empresa_ids(db, int(consultor.id))
            if not empresa_ids:
                return []
            query = query.where(Empresa.id.in_(empresa_ids))

        empresas = list(db.exec(query).all())
        logger.success(
            f"[CONSULTOR] {len(empresas)} empresas retornadas para {consultor.email}"
        )
        return empresas
    except Exception as e:
        logger.error(
            f"[CONSULTOR] Erro ao listar empresas para {consultor.email}: {e}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao listar empresas"
        )


@router.get("/empresas/{empresa_id}", response_model=EmpresaRead)
def obter_empresa_detalhes(
    empresa_id: int,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Obtém detalhes de uma empresa específica.
    Consultores podem acessar qualquer empresa.
    """
    logger.info(
        f"[CONSULTOR] Usuario {consultor.email} (ID: {consultor.id}) acessou empresa ID: {empresa_id}"
    )
    
    if not _is_super_consultor(consultor) and not tem_acesso(db, int(consultor.id), empresa_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sem acesso a esta empresa",
        )

    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        logger.warning(
            f"[CONSULTOR] Empresa ID {empresa_id} nao encontrada (consultor: {consultor.email})"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
        )

    if not empresa.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Empresa desativada"
        )
    
    logger.success(
        f"[CONSULTOR] Empresa {empresa.nome_fantasia} (ID: {empresa_id}) acessada por {consultor.email}"
    )
    return empresa


@router.post("/trocar-empresa", response_model=dict)
def trocar_contexto_empresa(
    contexto: EmpresaContexto,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Permite ao consultor trocar o contexto de empresa.
    Isso atualiza a empresa_id do usuário para facilitar navegação.
    Todas as trocas são logadas para auditoria.
    """
    empresa_id = contexto.empresa_id
    empresa_anterior_id = consultor.empresa_id
    
    if not _is_super_consultor(consultor) and not tem_acesso(db, int(consultor.id), empresa_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sem acesso a esta empresa",
        )

    # Verifica se a empresa existe
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        logger.warning(
            f"[CONSULTOR] Tentativa de trocar para empresa inexistente ID: {empresa_id} "
            f"(consultor: {consultor.email})"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
        )

    if not empresa.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Empresa desativada"
        )
    
    # Atualiza o contexto do consultor
    consultor.empresa_id = empresa_id
    db.add(consultor)
    db.commit()
    db.refresh(consultor)
    
    # Log de auditoria detalhado
    logger.info(
        f"[CONSULTOR] TROCA DE CONTEXTO - Usuario: {consultor.email} (ID: {consultor.id}) | "
        f"Empresa Anterior: {empresa_anterior_id} | Empresa Nova: {empresa_id} ({empresa.nome_fantasia}) | "
        f"Timestamp: {datetime.now().isoformat()}"
    )
    
    return {
        "success": True,
        "message": f"Contexto alterado para {empresa.nome_fantasia}",
        "empresa_anterior_id": empresa_anterior_id,
        "empresa_atual_id": empresa_id,
        "empresa_atual": {
            "id": empresa.id,
            "nome_fantasia": empresa.nome_fantasia,
            "razao_social": empresa.razao_social
        },
        "timestamp": datetime.now().isoformat()
    }


@router.get("/meu-contexto", response_model=dict)
def obter_contexto_atual(
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Retorna o contexto atual do consultor (empresa ativa).
    """
    empresa = _resolve_empresa_contexto(db, consultor)
    
    return {
        "consultor": {
            "id": consultor.id,
            "email": consultor.email,
            "is_consultor": consultor.is_consultor
        },
        "empresa_atual": {
            "id": empresa.id,
            "nome_fantasia": empresa.nome_fantasia,
            "razao_social": empresa.razao_social,
            "logo_url": empresa.logo_url,
            "cor_primaria": empresa.cor_primaria,
            "is_active": empresa.is_active,
        }
    }


# ==========================================
# NOVO: GERENCIAR ACESSO A MÚLTIPLAS EMPRESAS
# ==========================================

@router.get("/meu-acesso", response_model=List[dict])
def listar_acesso_empresas(
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Lista todas as empresas que o consultor tem acesso.
    """
    acessos = db.exec(
        select(ConsultorEmpresa)
        .where(
            ConsultorEmpresa.usuario_id == consultor.id,
            ConsultorEmpresa.ativo == True
        )
    ).all()
    
    # Eager load companies to avoid N+1 query
    empresa_ids = {acesso.empresa_id for acesso in acessos}
    empresas_map = {}
    if empresa_ids:
        empresas = db.exec(select(Empresa).where(Empresa.id.in_(list(empresa_ids)), Empresa.is_deleted == False)).all()
        empresas_map = {e.id: e for e in empresas if e.id is not None}
        
    result = []
    for acesso in acessos:
        empresa = empresas_map.get(acesso.empresa_id)
        if empresa:
            result.append({
                "acesso_id": acesso.id,
                "empresa_id": empresa.id,
                "nome_fantasia": empresa.nome_fantasia,
                "razao_social": empresa.razao_social,
                "ativo": acesso.ativo
            })
    
    logger.info(f"[CONSULTOR] {consultor.email} tem acesso a {len(result)} empresas")
    return result


@router.post("/empresas/{empresa_id}/adicionar-acesso")
def adicionar_acesso_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Adiciona acesso de um consultor a uma nova empresa.
    """
    if not _is_super_consultor(consultor):
        raise HTTPException(status_code=403, detail="Somente super consultor pode conceder acessos")

    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    if not empresa.is_active:
        raise HTTPException(status_code=403, detail="Empresa desativada")
    
    # Verifica se já tem acesso
    existe = db.exec(
        select(ConsultorEmpresa).where(
            ConsultorEmpresa.usuario_id == consultor.id,
            ConsultorEmpresa.empresa_id == empresa_id
        )
    ).first()
    
    if existe:
        if existe.ativo:
            raise HTTPException(
                status_code=400,
                detail="Consultor já tem acesso a essa empresa"
            )
        else:
            # Reativa o acesso
            existe.ativo = True
            db.add(existe)
            db.commit()
            logger.info(f"[CONSULTOR] Acesso reativado: {consultor.email} -> {empresa.nome_fantasia}")
            return {"mensagem": "Acesso reativado"}
    
    # Cria novo relacionamento
    novo_acesso = ConsultorEmpresa(
        usuario_id=consultor.id,
        empresa_id=empresa_id,
        ativo=True
    )
    db.add(novo_acesso)
    db.commit()
    
    logger.info(f"[CONSULTOR] Novo acesso: {consultor.email} -> {empresa.nome_fantasia}")
    return {"mensagem": "Acesso concedido", "acesso_id": novo_acesso.id}


@router.post("/empresas/{empresa_id}/revogar-acesso")
def revogar_acesso_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    """
    Revoga acesso de um consultor a uma empresa.
    """
    if not _is_super_consultor(consultor):
        raise HTTPException(status_code=403, detail="Somente super consultor pode revogar acessos")

    acesso = db.exec(
        select(ConsultorEmpresa).where(
            ConsultorEmpresa.usuario_id == consultor.id,
            ConsultorEmpresa.empresa_id == empresa_id
        )
    ).first()
    
    if not acesso:
        raise HTTPException(
            status_code=404,
            detail="Consultor não tem acesso a essa empresa"
        )
    
    # Soft delete: marca como inativo
    acesso.ativo = False
    db.add(acesso)
    db.commit()
    
    empresa = db.get(Empresa, empresa_id)
    logger.warning(f"[CONSULTOR] Acesso revogado: {consultor.email} -X-> {empresa.nome_fantasia if empresa else empresa_id}")
    
    return {"mensagem": "Acesso revogado"}

# ==========================================
# SUPER CONSULTOR: GERENCIAR OUTROS CONSULTORES
# ==========================================

@router.get("/super/consultores", response_model=List[dict])
def listar_consultores(
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """
    Super consultor lista todos os consultores do sistema.
    """
    consultores = db.exec(
        select(Usuario).where(
            Usuario.is_consultor == True,
            Usuario.is_deleted == False
        )
    ).all()
    
    # Eager load accesses to avoid N+1 query
    consultor_ids = [c.id for c in consultores if c.id is not None]
    acessos_map = {}
    if consultor_ids:
        acessos_all = db.exec(
            select(ConsultorEmpresa).where(
                ConsultorEmpresa.usuario_id.in_(consultor_ids),
                ConsultorEmpresa.ativo == True
            )
        ).all()
        for ac in acessos_all:
            acessos_map.setdefault(ac.usuario_id, []).append(ac)
            
    result = []
    for consultor in consultores:
        acessos = acessos_map.get(consultor.id, [])
        
        nome = getattr(consultor, "nome", None) or consultor.email

        result.append({
            "id": consultor.id,
            "nome": nome,  # Preferir nome real quando existir
            "email": consultor.email,
            "consultor_role": consultor.consultor_role,
            "empresa_atual_id": consultor.empresa_id,
            "num_empresas_acesso": len(acessos)
        })
    
    logger.info(f"[SUPER] {super_consultor.email} listou {len(result)} consultores")
    return result


@router.get("/super/consultores/{consultor_id}/empresas", response_model=List[dict])
def listar_empresas_consultor(
    consultor_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """
    Super consultor visualiza todas as empresas que um consultor tem acesso.
    """
    consultor = db.get(Usuario, consultor_id)
    if not consultor or not consultor.is_consultor or getattr(consultor, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Consultor não encontrado")
    
    acessos = db.exec(
        select(ConsultorEmpresa).where(
            ConsultorEmpresa.usuario_id == consultor_id,
            ConsultorEmpresa.ativo == True
        )
    ).all()
    
    # Eager load companies to avoid N+1 query
    empresa_ids = {acesso.empresa_id for acesso in acessos}
    empresas_map = {}
    if empresa_ids:
        empresas = db.exec(select(Empresa).where(Empresa.id.in_(list(empresa_ids)), Empresa.is_deleted == False)).all()
        empresas_map = {e.id: e for e in empresas if e.id is not None}
        
    result = []
    for acesso in acessos:
        empresa = empresas_map.get(acesso.empresa_id)
        if empresa:
            result.append({
                "acesso_id": acesso.id,
                "empresa_id": empresa.id,
                "nome_fantasia": empresa.nome_fantasia,
                "razao_social": empresa.razao_social,
                "ativo": acesso.ativo
            })
    
    logger.info(f"[SUPER] {super_consultor.email} visualizou acesso de {consultor.email} a {len(result)} empresas")
    return result


@router.post("/super/consultores/{consultor_id}/empresas/{empresa_id}/adicionar")
def super_adicionar_acesso_consultor(
    consultor_id: int,
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """
    Super consultor adiciona acesso a uma empresa para outro consultor.
    """
    consultor = db.get(Usuario, consultor_id)
    if not consultor or not consultor.is_consultor or getattr(consultor, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Consultor não encontrado")
    
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    if not empresa.is_active:
        raise HTTPException(status_code=403, detail="Empresa desativada")
    
    # Verifica se já tem acesso
    existe = db.exec(
        select(ConsultorEmpresa).where(
            ConsultorEmpresa.usuario_id == consultor_id,
            ConsultorEmpresa.empresa_id == empresa_id
        )
    ).first()
    
    if existe:
        if existe.ativo:
            raise HTTPException(
                status_code=400,
                detail="Consultor já tem acesso a essa empresa"
            )
        else:
            # Reativa
            existe.ativo = True
            db.add(existe)
            db.commit()
            logger.info(f"[SUPER] {super_consultor.email} reativou acesso de {consultor.email} -> {empresa.nome_fantasia}")
            return {"mensagem": "Acesso reativado"}
    
    # Cria novo
    novo_acesso = ConsultorEmpresa(
        usuario_id=consultor_id,
        empresa_id=empresa_id,
        ativo=True
    )
    db.add(novo_acesso)
    db.commit()
    
    logger.warning(f"[SUPER] {super_consultor.email} ADICIONOU acesso de {consultor.email} -> {empresa.nome_fantasia}")
    return {"mensagem": "Acesso concedido", "acesso_id": novo_acesso.id}


@router.post("/super/consultores/{consultor_id}/empresas/{empresa_id}/revogar")
def super_revogar_acesso_consultor(
    consultor_id: int,
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """
    Super consultor revoga acesso de um consultor a uma empresa.
    """
    consultor = db.get(Usuario, consultor_id)
    if not consultor or not consultor.is_consultor or getattr(consultor, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Consultor não encontrado")
    
    acesso = db.exec(
        select(ConsultorEmpresa).where(
            ConsultorEmpresa.usuario_id == consultor_id,
            ConsultorEmpresa.empresa_id == empresa_id
        )
    ).first()
    
    if not acesso:
        raise HTTPException(
            status_code=404,
            detail="Consultor não tem acesso a essa empresa"
        )
    
    acesso.ativo = False
    db.add(acesso)
    db.commit()
    
    empresa = db.get(Empresa, empresa_id)
    logger.critical(f"[SUPER] {super_consultor.email} REVOGOU acesso de {consultor.email} -X-> {empresa.nome_fantasia if empresa else empresa_id}")
    
    return {"mensagem": "Acesso revogado"}


@router.post("/super/consultores/{consultor_id}/role")
def super_alterar_role_consultor(
    consultor_id: int,
    role_data: RoleChangeRequest,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """
    Super consultor altera o papel (role) de outro consultor.
    """
    novo_role = role_data.role
    if novo_role not in [ConsultorRole.SUPER_CONSULTOR.value, ConsultorRole.CONSULTOR.value]:
        raise HTTPException(
            status_code=400,
            detail=f"Role inválido. Use {ConsultorRole.SUPER_CONSULTOR.value} ou {ConsultorRole.CONSULTOR.value}"
        )
    
    consultor = db.get(Usuario, consultor_id)
    if not consultor or not consultor.is_consultor or getattr(consultor, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Consultor não encontrado")
    
    if consultor.id == super_consultor.id:
        raise HTTPException(
            status_code=400,
            detail="Não pode alterar seu próprio role"
        )
    
    old_role = consultor.consultor_role
    consultor.consultor_role = novo_role
    db.add(consultor)
    db.commit()
    
    logger.critical(f"[SUPER] {super_consultor.email} alterou role de {consultor.email}: {old_role} -> {novo_role}")
    
    return {
        "mensagem": "Role alterado com sucesso",
        "consultor_id": consultor.id,
        "novo_role": novo_role
    }


# ==========================================
# SUPER CONSULTOR: EMPRESAS (DESATIVAR/ATIVAR/DELETAR)
# ==========================================

@router.post("/super/empresas/{empresa_id}/desativar")
def super_desativar_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    empresa.is_active = False
    empresa.updated_by_id = super_consultor.id
    db.add(empresa)
    db.commit()

    logger.warning(f"[SUPER] {super_consultor.email} desativou empresa {empresa_id}")
    return {"mensagem": "Empresa desativada"}


@router.post("/super/empresas/{empresa_id}/ativar")
def super_ativar_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    empresa.is_active = True
    empresa.updated_by_id = super_consultor.id
    db.add(empresa)
    db.commit()

    logger.warning(f"[SUPER] {super_consultor.email} ativou empresa {empresa_id}")
    return {"mensagem": "Empresa ativada"}


@router.delete("/super/empresas/{empresa_id}")
def super_deletar_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    empresa.is_active = False
    empresa.soft_delete(super_consultor.id)
    db.add(empresa)
    db.commit()

    logger.critical(f"[SUPER] {super_consultor.email} deletou empresa {empresa_id}")
    return {"mensagem": "Empresa deletada"}


# ==========================================
# SUPER CONSULTOR: USUÁRIOS (DESATIVAR/ATIVAR/RESET/DELETAR)
# ==========================================

@router.get("/super/usuarios", response_model=List[dict])
def listar_usuarios(
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    usuarios = db.exec(
        select(Usuario).where(
            Usuario.is_deleted == False,
            Usuario.is_service_account == False,
        )
    ).all()
    # Eager load companies to avoid N+1 query
    empresa_ids = {user.empresa_id for user in usuarios if user.empresa_id is not None}
    empresas_map = {}
    if empresa_ids:
        empresas = db.exec(select(Empresa).where(Empresa.id.in_(list(empresa_ids)), Empresa.is_deleted == False)).all()
        empresas_map = {e.id: e for e in empresas if e.id is not None}

    result: List[dict] = []
    for user in usuarios:
        empresa = empresas_map.get(user.empresa_id) if user.empresa_id else None
        result.append({
            "id": user.id,
            "nome": getattr(user, "nome", None),
            "email": user.email,
            "is_active": user.is_active,
            "is_consultor": user.is_consultor,
            "consultor_role": user.consultor_role,
            "empresa_id": user.empresa_id,
            "empresa_nome": empresa.nome_fantasia if empresa else None,
        })

    logger.info(f"[SUPER] {super_consultor.email} listou {len(result)} usuários")
    return result


@router.post("/super/usuarios/{user_id}/desativar")
def super_desativar_usuario(
    user_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    user = db.get(Usuario, user_id)
    if not user or getattr(user, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.id == super_consultor.id:
        raise HTTPException(status_code=400, detail="Não é possível desativar seu próprio usuário")

    user.is_active = False
    user.updated_by_id = super_consultor.id
    db.add(user)
    db.commit()

    logger.warning(f"[SUPER] {super_consultor.email} desativou usuário {user.email}")
    return {"mensagem": "Usuário desativado"}


@router.post("/super/usuarios/{user_id}/ativar")
def super_ativar_usuario(
    user_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    user = db.get(Usuario, user_id)
    if not user or getattr(user, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.is_active = True
    user.updated_by_id = super_consultor.id
    db.add(user)
    db.commit()

    logger.warning(f"[SUPER] {super_consultor.email} ativou usuário {user.email}")
    return {"mensagem": "Usuário ativado"}


@router.post("/super/usuarios/{user_id}/reset-senha")
def super_resetar_senha(
    user_id: int,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    user = db.get(Usuario, user_id)
    if not user or getattr(user, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.hashed_password = get_password_hash(payload.new_password)
    user.updated_by_id = super_consultor.id
    db.add(user)
    db.commit()

    logger.warning(f"[SUPER] {super_consultor.email} redefiniu senha do usuário {user.email}")
    return {"mensagem": "Senha redefinida"}


@router.delete("/super/usuarios/{user_id}")
def super_deletar_usuario(
    user_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    user = db.get(Usuario, user_id)
    if not user or getattr(user, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.id == super_consultor.id:
        raise HTTPException(status_code=400, detail="Não é possível deletar seu próprio usuário")

    user.is_active = False
    user.soft_delete(super_consultor.id)
    db.add(user)
    db.commit()

    logger.critical(f"[SUPER] {super_consultor.email} deletou usuário {user.email}")
    return {"mensagem": "Usuário deletado"}


# ==========================================
# SUPER CONSULTOR: TEMPLATES DE PLANO DE CONTAS
# ==========================================

@router.get("/super/plano-contas-templates/{tipo_pessoa}", response_model=List[PlanoContasRead])
def listar_template_plano_contas(
    tipo_pessoa: str,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    try:
        _assert_seed_template_manager(super_consultor)
        normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
        items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
        logger.info(f"[SUPER] {super_consultor.email} listou template de plano de contas {normalized}")
        return items
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[SUPER][TEMPLATE] Falha ao listar template {tipo_pessoa} para {super_consultor.email}: {exc}")
        raise HTTPException(status_code=500, detail=f"Erro ao listar template de plano de contas {tipo_pessoa}")


@router.post("/super/plano-contas-templates/{tipo_pessoa}", response_model=PlanoContasRead, status_code=201)
def criar_item_template_plano_contas(
    tipo_pessoa: str,
    conta_in: PlanoContasCreate,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    try:
        _assert_seed_template_manager(super_consultor)
        normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
        items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
        items_index = _template_items_index(items)

        conta_pai_id = conta_in.conta_pai_id
        if conta_pai_id is not None and conta_pai_id not in items_index:
            raise HTTPException(status_code=404, detail="Categoria pai do template nao encontrada")

        parent = items_index.get(conta_pai_id) if conta_pai_id is not None else None
        next_id = max((int(item["id"]) for item in items), default=0) + 1
        new_item = {
            "id": next_id,
            "nome": conta_in.nome,
            "tipo": parent["tipo"] if parent else conta_in.tipo,
            "codigo": None,
            "permite_lancamentos": conta_in.permite_lancamentos,
            "eh_operacional": conta_in.eh_operacional,
            "considerar_nos_resultados": conta_in.considerar_nos_resultados,
            "dre_grupo": parent.get("dre_grupo") if parent else conta_in.dre_grupo,
            "conta_pai_id": conta_pai_id,
        }
        items.append(new_item)
        if not crud_plano_contas.can_manage_operational_flag(super_consultor.email):
            items = crud_plano_contas.sync_template_operational_hierarchy(items)
        crud_plano_contas.save_template_items(db=db, tipo_pessoa=normalized, items=items)
        logger.warning(f"[SUPER] {super_consultor.email} criou item no template {normalized}: {conta_in.nome}")
        return new_item
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[SUPER][TEMPLATE] Falha ao criar item no template {tipo_pessoa} para {super_consultor.email}: {exc}")
        raise HTTPException(status_code=500, detail=f"Erro ao criar categoria no template de plano de contas {tipo_pessoa}")


@router.patch("/super/plano-contas-templates/{tipo_pessoa}/{conta_id}", response_model=PlanoContasRead)
def atualizar_item_template_plano_contas(
    tipo_pessoa: str,
    conta_id: int,
    conta_in: PlanoContasUpdate,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    try:
        _assert_seed_template_manager(super_consultor)
        normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
        items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
        items_index = _template_items_index(items)
        item = items_index.get(conta_id)
        if not item:
            raise HTTPException(status_code=404, detail="Categoria do template nao encontrada")

        update_data = conta_in.model_dump(exclude_unset=True)
        new_parent_id = update_data.get("conta_pai_id", item.get("conta_pai_id"))
        if new_parent_id == conta_id:
            raise HTTPException(status_code=400, detail="A categoria nao pode ser pai dela mesma")
        if new_parent_id is not None and new_parent_id not in items_index:
            raise HTTPException(status_code=404, detail="Categoria pai do template nao encontrada")
        if new_parent_id is not None and new_parent_id in _template_descendants(items_index, conta_id):
            raise HTTPException(status_code=400, detail="Nao e permitido mover uma categoria para dentro de uma subcategoria dela")

        parent = items_index.get(new_parent_id) if new_parent_id is not None else None
        if "nome" in update_data and update_data["nome"] is not None:
            item["nome"] = update_data["nome"]
        if "considerar_nos_resultados" in update_data and update_data["considerar_nos_resultados"] is not None:
            item["considerar_nos_resultados"] = update_data["considerar_nos_resultados"]
        if "eh_operacional" in update_data and update_data["eh_operacional"] is not None:
            item["eh_operacional"] = update_data["eh_operacional"]
        if "permite_lancamentos" in update_data and update_data["permite_lancamentos"] is not None:
            item["permite_lancamentos"] = update_data["permite_lancamentos"]
        if "dre_grupo" in update_data and update_data["dre_grupo"] is not None:
            item["dre_grupo"] = update_data["dre_grupo"]
        if "tipo" in update_data and update_data["tipo"] is not None:
            item["tipo"] = update_data["tipo"]
        if "conta_pai_id" in update_data:
            item["conta_pai_id"] = new_parent_id
            if parent:
                item["tipo"] = parent["tipo"]
                item["dre_grupo"] = parent.get("dre_grupo", item.get("dre_grupo"))

        if not crud_plano_contas.can_manage_operational_flag(super_consultor.email):
            items = crud_plano_contas.sync_template_operational_hierarchy(items)

        crud_plano_contas.save_template_items(db=db, tipo_pessoa=normalized, items=items)
        logger.warning(f"[SUPER] {super_consultor.email} atualizou item {conta_id} do template {normalized}")
        return item
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[SUPER][TEMPLATE] Falha ao atualizar item {conta_id} no template {tipo_pessoa} para {super_consultor.email}: {exc}")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar categoria {conta_id} do template de plano de contas {tipo_pessoa}")


@router.delete("/super/plano-contas-templates/{tipo_pessoa}/{conta_id}")
def deletar_item_template_plano_contas(
    tipo_pessoa: str,
    conta_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    try:
        _assert_seed_template_manager(super_consultor)
        normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
        items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
        item = next((current for current in items if int(current["id"]) == conta_id), None)
        if not item:
            raise HTTPException(status_code=404, detail="Categoria do template nao encontrada")

        child_count = sum(1 for current in items if current.get("conta_pai_id") == conta_id)
        if child_count > 0:
            raise HTTPException(status_code=400, detail="Nao e possivel excluir uma categoria do template que possui subcategorias")

        updated_items = [current for current in items if int(current["id"]) != conta_id]
        crud_plano_contas.save_template_items(db=db, tipo_pessoa=normalized, items=updated_items)
        logger.warning(f"[SUPER] {super_consultor.email} removeu item {conta_id} do template {normalized}")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[SUPER][TEMPLATE] Falha ao remover item {conta_id} do template {tipo_pessoa} para {super_consultor.email}: {exc}")
        raise HTTPException(status_code=500, detail=f"Erro ao remover categoria {conta_id} do template de plano de contas {tipo_pessoa}")


@router.post("/super/plano-contas-templates/{tipo_pessoa}/reordenar")
def reordenar_template_plano_contas(
    tipo_pessoa: str,
    itens: List[PlanoContasTemplateReordenacaoItem],
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    try:
        _assert_seed_template_manager(super_consultor)
        normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
        items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
        items_index = _template_items_index(items)

        if len(items) != len(itens):
            raise HTTPException(status_code=400, detail="Envie a estrutura completa do template para reordenar")

        updated_items: List[dict] = []
        for payload in itens:
            current = items_index.get(payload.id)
            if not current:
                raise HTTPException(status_code=404, detail=f"Categoria do template {payload.id} nao encontrada")
            updated_items.append(
                {
                    **current,
                    "codigo": payload.codigo,
                    "conta_pai_id": payload.conta_pai_id,
                    "tipo": payload.tipo,
                }
            )

        if not crud_plano_contas.can_manage_operational_flag(super_consultor.email):
            updated_items = crud_plano_contas.sync_template_operational_hierarchy(updated_items)

        crud_plano_contas.save_template_items(db=db, tipo_pessoa=normalized, items=updated_items)
        logger.warning(f"[SUPER] {super_consultor.email} reordenou template {normalized}")
        return {"message": "Template salvo com sucesso"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[SUPER][TEMPLATE] Falha ao reordenar template {tipo_pessoa} para {super_consultor.email}: {exc}")
        raise HTTPException(status_code=500, detail=f"Erro ao reordenar template de plano de contas {tipo_pessoa}")


@router.get("/super/auto-adjustment-config/{tipo_pessoa}", response_model=AutoAdjustmentConfigRead)
def obter_config_ajuste_automatico(
    tipo_pessoa: str,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    _assert_seed_template_manager(super_consultor)
    normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
    config = crud_auto_adjustment_config.get_for_tipo_pessoa(db=db, tipo_pessoa=normalized)
    juros = config.get("juros_multa") or {}
    descontos = config.get("descontos") or {}
    return AutoAdjustmentConfigRead(
        tipo_pessoa=normalized,
        juros_multa_template_id=juros.get("template_id"),
        descontos_template_id=descontos.get("template_id"),
        juros_multa_categoria_nome=str(juros.get("categoria_nome") or "Juros e Multas"),
        descontos_categoria_nome=str(descontos.get("categoria_nome") or "Descontos Concedidos"),
        juros_multa_tipo=str(juros.get("tipo") or "D"),
        descontos_tipo=str(descontos.get("tipo") or "D"),
        juros_multa_dre_grupo=str(juros.get("dre_grupo") or "OUTRAS_DESPESAS"),
        descontos_dre_grupo=str(descontos.get("dre_grupo") or "DEDUCOES_RECEITA"),
    )


@router.put("/super/auto-adjustment-config/{tipo_pessoa}", response_model=AutoAdjustmentConfigRead)
def salvar_config_ajuste_automatico(
    tipo_pessoa: str,
    payload: AutoAdjustmentConfigWrite,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    _assert_seed_template_manager(super_consultor)
    normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)

    template_items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
    template_index = _template_items_index(template_items)

    juros_item = template_index.get(int(payload.juros_multa_template_id)) if payload.juros_multa_template_id is not None else None
    descontos_item = template_index.get(int(payload.descontos_template_id)) if payload.descontos_template_id is not None else None

    if payload.juros_multa_template_id is not None and juros_item is None:
        raise HTTPException(status_code=404, detail="Categoria de juros/multa não encontrada no template")
    if payload.descontos_template_id is not None and descontos_item is None:
        raise HTTPException(status_code=404, detail="Categoria de descontos não encontrada no template")

    juros_payload = {
        "template_id": int(juros_item["id"]) if juros_item else None,
        "categoria_nome": str((juros_item or {}).get("nome") or "Juros e Multas"),
        "tipo": str((juros_item or {}).get("tipo") or "D"),
        "dre_grupo": str((juros_item or {}).get("dre_grupo") or "OUTRAS_DESPESAS"),
    }
    descontos_payload = {
        "template_id": int(descontos_item["id"]) if descontos_item else None,
        "categoria_nome": str((descontos_item or {}).get("nome") or "Descontos Concedidos"),
        "tipo": str((descontos_item or {}).get("tipo") or "D"),
        "dre_grupo": str((descontos_item or {}).get("dre_grupo") or "DEDUCOES_RECEITA"),
    }

    saved = crud_auto_adjustment_config.save_for_tipo_pessoa(
        db=db,
        tipo_pessoa=normalized,
        juros_multa=juros_payload,
        descontos=descontos_payload,
    )

    logger.warning(f"[SUPER] {super_consultor.email} salvou config global de ajuste automático {normalized}")

    juros = saved.get("juros_multa") or {}
    descontos = saved.get("descontos") or {}
    return AutoAdjustmentConfigRead(
        tipo_pessoa=normalized,
        juros_multa_template_id=juros.get("template_id"),
        descontos_template_id=descontos.get("template_id"),
        juros_multa_categoria_nome=str(juros.get("categoria_nome") or "Juros e Multas"),
        descontos_categoria_nome=str(descontos.get("categoria_nome") or "Descontos Concedidos"),
        juros_multa_tipo=str(juros.get("tipo") or "D"),
        descontos_tipo=str(descontos.get("tipo") or "D"),
        juros_multa_dre_grupo=str(juros.get("dre_grupo") or "OUTRAS_DESPESAS"),
        descontos_dre_grupo=str(descontos.get("dre_grupo") or "DEDUCOES_RECEITA"),
    )


@router.get("/super/empresas/{empresa_id}/plano-contas-opcoes", response_model=List[EmpresaPlanoContasOptionRead])
def listar_plano_contas_opcoes_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    _assert_seed_template_manager(super_consultor)
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    rows = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
            PlanoContas.permite_lancamentos == True,
        )
    ).all()
    ordered = sorted(list(rows), key=lambda item: ((item.codigo or ""), str(item.nome or "").lower(), int(item.id or 0)))
    return [
        EmpresaPlanoContasOptionRead(
            id=int(item.id),
            nome=str(item.nome),
            tipo=str(item.tipo or "D"),
            dre_grupo=str(item.dre_grupo or "DESPESAS_OPERACIONAIS"),
            conta_pai_id=item.conta_pai_id,
        )
        for item in ordered
        if item.id is not None
    ]


@router.get("/super/empresas/{empresa_id}/auto-adjustment-config", response_model=AutoAdjustmentEmpresaConfigRead)
def obter_config_ajuste_automatico_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    _assert_seed_template_manager(super_consultor)
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    tipo = _normalizar_tipo_pessoa_template(str(empresa.tipo_pessoa or "PJ"))
    config = crud_auto_adjustment_config.get_for_empresa(db=db, empresa_id=empresa_id, tipo_pessoa=tipo)
    juros = config.get("juros_multa") or {}
    descontos = config.get("descontos") or {}
    return AutoAdjustmentEmpresaConfigRead(
        empresa_id=empresa_id,
        tipo_pessoa=tipo,
        juros_multa_plano_contas_id=juros.get("plano_contas_id"),
        descontos_plano_contas_id=descontos.get("plano_contas_id"),
        juros_multa_categoria_nome=str(juros.get("categoria_nome") or "Juros e Multas"),
        descontos_categoria_nome=str(descontos.get("categoria_nome") or "Descontos Concedidos"),
        juros_multa_tipo=str(juros.get("tipo") or "D"),
        descontos_tipo=str(descontos.get("tipo") or "D"),
        juros_multa_dre_grupo=str(juros.get("dre_grupo") or "OUTRAS_DESPESAS"),
        descontos_dre_grupo=str(descontos.get("dre_grupo") or "DEDUCOES_RECEITA"),
    )


@router.put("/super/empresas/{empresa_id}/auto-adjustment-config", response_model=AutoAdjustmentEmpresaConfigRead)
def salvar_config_ajuste_automatico_empresa(
    empresa_id: int,
    payload: AutoAdjustmentEmpresaConfigWrite,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    _assert_seed_template_manager(super_consultor)
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    tipo = _normalizar_tipo_pessoa_template(str(empresa.tipo_pessoa or "PJ"))
    rows = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
            PlanoContas.permite_lancamentos == True,
        )
    ).all()
    index = {int(item.id): item for item in rows if item.id is not None}

    juros_item = index.get(int(payload.juros_multa_plano_contas_id)) if payload.juros_multa_plano_contas_id is not None else None
    descontos_item = index.get(int(payload.descontos_plano_contas_id)) if payload.descontos_plano_contas_id is not None else None

    if payload.juros_multa_plano_contas_id is not None and juros_item is None:
        raise HTTPException(status_code=404, detail="Categoria de juros/multa não encontrada na empresa")
    if payload.descontos_plano_contas_id is not None and descontos_item is None:
        raise HTTPException(status_code=404, detail="Categoria de descontos não encontrada na empresa")

    juros_payload = {
        "plano_contas_id": int(juros_item.id) if juros_item and juros_item.id is not None else None,
        "categoria_nome": str((juros_item.nome if juros_item else None) or "Juros e Multas"),
        "tipo": str((juros_item.tipo if juros_item else None) or "D"),
        "dre_grupo": str((juros_item.dre_grupo if juros_item else None) or "OUTRAS_DESPESAS"),
    }
    descontos_payload = {
        "plano_contas_id": int(descontos_item.id) if descontos_item and descontos_item.id is not None else None,
        "categoria_nome": str((descontos_item.nome if descontos_item else None) or "Descontos Concedidos"),
        "tipo": str((descontos_item.tipo if descontos_item else None) or "D"),
        "dre_grupo": str((descontos_item.dre_grupo if descontos_item else None) or "DEDUCOES_RECEITA"),
    }

    saved = crud_auto_adjustment_config.save_for_empresa(
        db=db,
        empresa_id=empresa_id,
        tipo_pessoa=tipo,
        juros_multa=juros_payload,
        descontos=descontos_payload,
    )

    juros = saved.get("juros_multa") or {}
    descontos = saved.get("descontos") or {}
    logger.warning(f"[SUPER] {super_consultor.email} salvou config por empresa de ajuste automático empresa={empresa_id}")
    return AutoAdjustmentEmpresaConfigRead(
        empresa_id=empresa_id,
        tipo_pessoa=tipo,
        juros_multa_plano_contas_id=juros.get("plano_contas_id"),
        descontos_plano_contas_id=descontos.get("plano_contas_id"),
        juros_multa_categoria_nome=str(juros.get("categoria_nome") or "Juros e Multas"),
        descontos_categoria_nome=str(descontos.get("categoria_nome") or "Descontos Concedidos"),
        juros_multa_tipo=str(juros.get("tipo") or "D"),
        descontos_tipo=str(descontos.get("tipo") or "D"),
        juros_multa_dre_grupo=str(juros.get("dre_grupo") or "OUTRAS_DESPESAS"),
        descontos_dre_grupo=str(descontos.get("dre_grupo") or "DEDUCOES_RECEITA"),
    )


class TemplateImportPayload(BaseModel):
    items: List[dict]


class SincronizarTemplateRequest(BaseModel):
    tipo_pessoa: Optional[str] = None


@router.get("/super/plano-contas-templates/{tipo_pessoa}/exportar")
def exportar_template_plano_contas(
    tipo_pessoa: str,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """Exporta todo o template de plano de contas (PF ou PJ) em formato JSON estruturado."""
    _assert_seed_template_manager(super_consultor)
    normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
    items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)
    logger.info(f"[SUPER] {super_consultor.email} exportou template {normalized} ({len(items)} categorias)")
    return {
        "tipo_pessoa": normalized,
        "total_itens": len(items),
        "exported_at": datetime.now().isoformat(),
        "items": items,
    }


@router.post("/super/plano-contas-templates/{tipo_pessoa}/importar")
def importar_template_plano_contas(
    tipo_pessoa: str,
    payload: TemplateImportPayload,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """Importa e substitui a estrutura do template de plano de contas a partir de um JSON."""
    _assert_seed_template_manager(super_consultor)
    normalized = _normalizar_tipo_pessoa_template(tipo_pessoa)
    if not payload.items or not isinstance(payload.items, list):
        raise HTTPException(status_code=400, detail="A lista de categorias não pode estar vazia")

    for item in payload.items:
        if not item.get("nome") or not item.get("tipo"):
            raise HTTPException(status_code=400, detail="Cada item do template precisa conter ao menos 'nome' e 'tipo'")

    crud_plano_contas.save_template_items(db=db, tipo_pessoa=normalized, items=payload.items)
    logger.warning(f"[SUPER] {super_consultor.email} importou novo template {normalized} com {len(payload.items)} itens")
    return {"success": True, "message": f"Template {normalized} importado com sucesso", "total_itens": len(payload.items)}


@router.post("/super/empresas/{empresa_id}/sincronizar-template")
def sincronizar_template_empresa(
    empresa_id: int,
    payload: Optional[SincronizarTemplateRequest] = None,
    db: Session = Depends(get_db),
    super_consultor: Usuario = Depends(get_super_consultor_user),
):
    """Sincroniza o plano padrão (PF ou PJ) com uma empresa, criando categorias faltantes sem apagar dados existentes."""
    _assert_seed_template_manager(super_consultor)
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    tipo = (payload.tipo_pessoa if payload and payload.tipo_pessoa else getattr(empresa, "tipo_pessoa", None)) or "PJ"
    normalized = _normalizar_tipo_pessoa_template(str(tipo))
    template_items = crud_plano_contas.get_template_items(db=db, tipo_pessoa=normalized)

    existentes = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False
        )
    ).all()

    existentes_por_nome = {item.nome.strip().lower(): item for item in existentes}
    template_id_map: dict[int, int] = {}

    for item in existentes:
        for t_item in template_items:
            if t_item.get("nome", "").strip().lower() == item.nome.strip().lower():
                template_id_map[int(t_item["id"])] = int(item.id)

    novas_criadas = 0
    # Processar pais antes de filhos
    for t_item in sorted(template_items, key=lambda x: (x.get("conta_pai_id") is not None, int(x.get("id", 0)))):
        nome_norm = str(t_item.get("nome", "")).strip().lower()
        if nome_norm not in existentes_por_nome:
            parent_tid = t_item.get("conta_pai_id")
            parent_id = template_id_map.get(int(parent_tid)) if parent_tid is not None else None

            nova_conta = PlanoContas(
                nome=str(t_item.get("nome", "")).strip(),
                tipo=str(t_item.get("tipo", "D")),
                codigo=t_item.get("codigo"),
                dre_grupo=t_item.get("dre_grupo", "DESPESAS_OPERACIONAIS"),
                empresa_id=empresa_id,
                conta_pai_id=parent_id,
                permite_lancamentos=bool(t_item.get("permite_lancamentos", True)),
                eh_operacional=bool(t_item.get("eh_operacional", True)),
                considerar_nos_resultados=bool(t_item.get("considerar_nos_resultados", True)),
                oculta=False,
            )
            db.add(nova_conta)
            db.flush()
            template_id_map[int(t_item["id"])] = int(nova_conta.id)
            existentes_por_nome[nome_norm] = nova_conta
            novas_criadas += 1

    crud_plano_contas.ensure_transfer_category(db=db, empresa_id=empresa_id)
    db.commit()

    logger.warning(f"[SUPER] {super_consultor.email} sincronizou template {normalized} com empresa {empresa.nome_fantasia} (+{novas_criadas} contas)")
    return {
        "success": True,
        "message": f"Template {normalized} sincronizado com sucesso. {novas_criadas} novas categorias adicionadas.",
        "novas_categorias_criadas": novas_criadas,
        "total_categorias_empresa": len(existentes_por_nome),
    }


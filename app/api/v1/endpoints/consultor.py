"""
Endpoints exclusivos para consultores internos.
Super consultores têm acesso global; consultores comuns operam apenas nas empresas autorizadas.
Todas as operações são logadas para auditoria e segurança.
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from sqlalchemy import or_
from loguru import logger
from typing import List, Optional

from app.db.session import get_db
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa
from app.models.todo_item import TodoItem
from app.api.v1.deps import get_consultor_user, get_current_active_user, get_super_consultor_user
from app.schemas.empresa import EmpresaRead
from app.schemas.todo import TodoCreate, TodoUpdate, TodoRead
from app.enums import ConsultorRole
from app.core.security import get_password_hash
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

    if empresa_id:
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


class RoleChangeRequest(BaseModel):
    """Schema para mudança de role"""
    role: str


class EmpresaContexto(BaseModel):
    """Schema para troca de contexto de empresa"""
    empresa_id: int


class ResetPasswordRequest(BaseModel):
    """Schema para redefinição de senha"""
    new_password: str


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
            "razao_social": empresa.razao_social
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
    
    result = []
    for acesso in acessos:
        empresa = db.get(Empresa, acesso.empresa_id)
        if empresa and not empresa.is_deleted:
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
    
    result = []
    for consultor in consultores:
        acessos = db.exec(
            select(ConsultorEmpresa).where(
                ConsultorEmpresa.usuario_id == consultor.id,
                ConsultorEmpresa.ativo == True
            )
        ).all()
        
        nome = getattr(consultor, "nome", None) or consultor.email

        result.append({
            "id": consultor.id,
            "nome": nome,  # Preferir nome real quando existir
            "email": _mask_email(consultor.email),
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
    if not consultor or not consultor.is_consultor:
        raise HTTPException(status_code=404, detail="Consultor não encontrado")
    
    acessos = db.exec(
        select(ConsultorEmpresa).where(
            ConsultorEmpresa.usuario_id == consultor_id,
            ConsultorEmpresa.ativo == True
        )
    ).all()
    
    result = []
    for acesso in acessos:
        empresa = db.get(Empresa, acesso.empresa_id)
        if empresa and not empresa.is_deleted:
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
    if not consultor or not consultor.is_consultor:
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
    if not consultor or not consultor.is_consultor:
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
    if not consultor or not consultor.is_consultor:
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
    usuarios = db.exec(select(Usuario).where(Usuario.is_deleted == False)).all()
    result: List[dict] = []
    for user in usuarios:
        empresa = db.get(Empresa, user.empresa_id) if user.empresa_id else None
        result.append({
            "id": user.id,
            "nome": getattr(user, "nome", None),
            "email": _mask_email(user.email),
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
    if not user:
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
    if not user:
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
    if not user:
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
    if not user:
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
# TODO LIST (CONSULTORES E EMPRESAS)
# ==========================================

@router.get("/todos", response_model=List[TodoRead])
def listar_todos(
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
    empresa_id: Optional[int] = None,
    consultor_id: Optional[int] = None,
    status: Optional[str] = None,
    tipo_alvo: Optional[str] = None,
):
    query = select(TodoItem).where(TodoItem.is_deleted == False)

    if empresa_id is not None:
        if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value and not tem_acesso(db, consultor.id, empresa_id):
            raise HTTPException(status_code=403, detail="Sem acesso à empresa informada")
        query = query.where(TodoItem.empresa_id == empresa_id)

    if consultor_id is not None:
        if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value and consultor_id != consultor.id:
            raise HTTPException(status_code=403, detail="Sem acesso ao consultor informado")
        query = query.where(TodoItem.consultor_id == consultor_id)

    if status:
        query = query.where(TodoItem.status == status)

    if tipo_alvo:
        query = query.where(TodoItem.tipo_alvo == tipo_alvo)

    if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        empresas_subq = select(ConsultorEmpresa.empresa_id).where(
            ConsultorEmpresa.usuario_id == consultor.id,
            ConsultorEmpresa.ativo == True
        )
        query = query.where(
            or_(
                TodoItem.consultor_id == consultor.id,
                TodoItem.empresa_id.in_(empresas_subq)
            )
        )

    return list(db.exec(query).all())


@router.post("/todos", response_model=TodoRead, status_code=status.HTTP_201_CREATED)
def criar_todo(
    todo_in: TodoCreate,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    if todo_in.tipo_alvo not in ["EMPRESA", "CONSULTOR"]:
        raise HTTPException(status_code=400, detail="tipo_alvo inválido")

    if todo_in.periodicidade not in ["UNICA", "DIARIA", "SEMANAL"]:
        raise HTTPException(status_code=400, detail="periodicidade inválida")

    if todo_in.periodicidade != "UNICA" and not todo_in.end_date:
        raise HTTPException(status_code=400, detail="end_date é obrigatório para tarefas recorrentes")

    if todo_in.periodicidade == "SEMANAL" and not todo_in.dias_semana:
        raise HTTPException(status_code=400, detail="dias_semana é obrigatório para periodicidade SEMANAL")

    if todo_in.end_date and todo_in.due_date and todo_in.end_date < todo_in.due_date:
        raise HTTPException(status_code=400, detail="end_date não pode ser menor que due_date")

    if todo_in.tipo_alvo == "EMPRESA" and not todo_in.empresa_id:
        raise HTTPException(status_code=400, detail="empresa_id é obrigatório para tipo_alvo EMPRESA")

    if todo_in.tipo_alvo == "CONSULTOR" and not todo_in.consultor_id:
        raise HTTPException(status_code=400, detail="consultor_id é obrigatório para tipo_alvo CONSULTOR")

    if todo_in.empresa_id:
        empresa = db.get(Empresa, todo_in.empresa_id)
        if not empresa or empresa.is_deleted:
            raise HTTPException(status_code=404, detail="Empresa não encontrada")
        if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value and not tem_acesso(db, consultor.id, todo_in.empresa_id):
            raise HTTPException(status_code=403, detail="Sem acesso à empresa informada")

    if todo_in.consultor_id:
        alvo = db.get(Usuario, todo_in.consultor_id)
        if not alvo:
            raise HTTPException(status_code=404, detail="Consultor não encontrado")
        if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value and todo_in.consultor_id != consultor.id:
            raise HTTPException(status_code=403, detail="Sem permissão para criar tarefa para outro consultor")

    def normalize_date(dt: datetime) -> datetime:
        return datetime(dt.year, dt.month, dt.day)

    def get_weekday_code(d: datetime) -> str:
        return ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"][d.weekday()]

    occurrences: List[TodoItem] = []

    if todo_in.due_date:
        start = normalize_date(todo_in.due_date)
    else:
        start = normalize_date(datetime.now())

    if todo_in.periodicidade == "UNICA":
        todo = TodoItem.model_validate(todo_in)
        todo.due_date = start
        todo.created_by_id = consultor.id
        occurrences.append(todo)
    else:
        end = normalize_date(todo_in.end_date) if todo_in.end_date else start
        dias_semana = []
        if todo_in.dias_semana:
            dias_semana = [d.strip().upper() for d in todo_in.dias_semana.split(',') if d.strip()]
        if todo_in.inclui_sabado and "SAB" not in dias_semana:
            dias_semana.append("SAB")

        current = start
        while current <= end:
            weekday_code = get_weekday_code(current)
            if todo_in.periodicidade == "DIARIA":
                if not todo_in.inclui_sabado and weekday_code == "SAB":
                    current = current + timedelta(days=1)
                    continue
                todo = TodoItem.model_validate(todo_in)
                todo.due_date = current
                todo.created_by_id = consultor.id
                occurrences.append(todo)
            elif todo_in.periodicidade == "SEMANAL":
                if weekday_code in dias_semana:
                    todo = TodoItem.model_validate(todo_in)
                    todo.due_date = current
                    todo.created_by_id = consultor.id
                    occurrences.append(todo)
            current = current + timedelta(days=1)

    for item in occurrences:
        db.add(item)
    db.commit()

    logger.info(f"[CONSULTOR] {consultor.email} criou {len(occurrences)} tarefa(s)")
    if len(occurrences) == 1:
        db.refresh(occurrences[0])
        return occurrences[0]

    return occurrences[0]


@router.patch("/todos/{todo_id}", response_model=TodoRead)
def atualizar_todo(
    todo_id: int,
    todo_in: TodoUpdate,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    todo = db.get(TodoItem, todo_id)
    if not todo or todo.is_deleted:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        if todo.consultor_id and todo.consultor_id != consultor.id:
            raise HTTPException(status_code=403, detail="Sem permissão para alterar esta tarefa")
        if todo.empresa_id and not tem_acesso(db, consultor.id, todo.empresa_id):
            raise HTTPException(status_code=403, detail="Sem acesso à empresa desta tarefa")

    data = todo_in.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(todo, key, value)

    todo.updated_by_id = consultor.id
    db.add(todo)
    db.commit()
    db.refresh(todo)

    return todo


@router.delete("/todos/{todo_id}")
def deletar_todo(
    todo_id: int,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    todo = db.get(TodoItem, todo_id)
    if not todo or todo.is_deleted:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        if todo.consultor_id and todo.consultor_id != consultor.id:
            raise HTTPException(status_code=403, detail="Sem permissão para deletar esta tarefa")
        if todo.empresa_id and not tem_acesso(db, consultor.id, todo.empresa_id):
            raise HTTPException(status_code=403, detail="Sem acesso à empresa desta tarefa")

    todo.soft_delete(consultor.id)
    db.add(todo)
    db.commit()

    return {"mensagem": "Tarefa deletada"}


@router.post("/todos/{todo_id}/iniciar", response_model=TodoRead)
def iniciar_todo(
    todo_id: int,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    todo = db.get(TodoItem, todo_id)
    if not todo or todo.is_deleted:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        if todo.consultor_id and todo.consultor_id != consultor.id:
            raise HTTPException(status_code=403, detail="Sem permissão para iniciar esta tarefa")
        if todo.empresa_id and not tem_acesso(db, consultor.id, todo.empresa_id):
            raise HTTPException(status_code=403, detail="Sem acesso à empresa desta tarefa")

    todo.last_started_at = datetime.utcnow()
    todo.status = "EM_ANDAMENTO"
    todo.updated_by_id = consultor.id
    db.add(todo)
    db.commit()
    db.refresh(todo)

    return todo


@router.post("/todos/{todo_id}/finalizar", response_model=TodoRead)
def finalizar_todo(
    todo_id: int,
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    todo = db.get(TodoItem, todo_id)
    if not todo or todo.is_deleted:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        if todo.consultor_id and todo.consultor_id != consultor.id:
            raise HTTPException(status_code=403, detail="Sem permissão para finalizar esta tarefa")
        if todo.empresa_id and not tem_acesso(db, consultor.id, todo.empresa_id):
            raise HTTPException(status_code=403, detail="Sem acesso à empresa desta tarefa")

    now = datetime.utcnow()
    if todo.last_started_at:
        delta = now - todo.last_started_at
        todo.total_seconds = max(0, todo.total_seconds + int(delta.total_seconds()))

    todo.finished_at = now
    todo.status = "CONCLUIDO"
    todo.updated_by_id = consultor.id
    db.add(todo)
    db.commit()
    db.refresh(todo)

    return todo


@router.get("/todos/resumo", response_model=dict)
def resumo_todos(
    db: Session = Depends(get_db),
    consultor: Usuario = Depends(get_consultor_user),
):
    base_query = select(TodoItem).where(TodoItem.is_deleted == False)

    if consultor.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        empresas_subq = select(ConsultorEmpresa.empresa_id).where(
            ConsultorEmpresa.usuario_id == consultor.id,
            ConsultorEmpresa.ativo == True
        )
        base_query = base_query.where(
            or_(
                TodoItem.consultor_id == consultor.id,
                TodoItem.empresa_id.in_(empresas_subq)
            )
        )

    todos = list(db.exec(base_query).all())
    today = datetime.now().date()
    tomorrow = today + timedelta(days=1)
    week_end = today + timedelta(days=7)

    def is_overdue(t: TodoItem) -> bool:
        return bool(t.due_date and t.due_date.date() < today and t.status != "CONCLUIDO")

    def is_completed_late(t: TodoItem) -> bool:
        return bool(
            t.status == "CONCLUIDO"
            and t.due_date
            and t.finished_at
            and t.finished_at.date() > t.due_date.date()
        )

    summary = {
        "amanha": 0,
        "semana": 0,
        "futuras": 0,
        "atrasadas": 0,
        "concluidas_atraso": 0,
    }

    for t in todos:
        if t.is_deleted:
            continue
        if t.due_date:
            due = t.due_date.date()
            if t.status != "CONCLUIDO" and due == tomorrow:
                summary["amanha"] += 1
            if t.status != "CONCLUIDO" and today <= due <= week_end:
                summary["semana"] += 1
            if t.status != "CONCLUIDO" and due > week_end:
                summary["futuras"] += 1
        if is_overdue(t):
            summary["atrasadas"] += 1
        if is_completed_late(t):
            summary["concluidas_atraso"] += 1

    return summary
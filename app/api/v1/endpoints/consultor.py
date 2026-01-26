"""
Endpoints exclusivos para consultores internos.
Consultores têm acesso a todas as empresas e podem trocar de contexto.
Todas as operações são logadas para auditoria e segurança.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from loguru import logger
from typing import List

from app.db.session import get_db
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa
from app.api.v1.deps import get_consultor_user, get_current_active_user, get_super_consultor_user
from app.schemas.empresa import EmpresaRead
from app.enums import ConsultorRole
from pydantic import BaseModel

router = APIRouter()


class RoleChangeRequest(BaseModel):
    """Schema para mudança de role"""
    role: str


class EmpresaContexto(BaseModel):
    """Schema para troca de contexto de empresa"""
    empresa_id: int


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
        empresas = list(db.exec(select(Empresa)).all())
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
    
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        logger.warning(
            f"[CONSULTOR] Empresa ID {empresa_id} nao encontrada (consultor: {consultor.email})"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
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
    
    # Verifica se a empresa existe
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        logger.warning(
            f"[CONSULTOR] Tentativa de trocar para empresa inexistente ID: {empresa_id} "
            f"(consultor: {consultor.email})"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
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
    empresa = db.get(Empresa, consultor.empresa_id)
    if not empresa:
        logger.warning(
            f"[CONSULTOR] Empresa ID {consultor.empresa_id} nao encontrada para consultor {consultor.email}"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa do contexto não encontrada"
        )
    
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
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    
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
        select(Usuario).where(Usuario.is_consultor == True)
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
    if not consultor or not consultor.is_consultor:
        raise HTTPException(status_code=404, detail="Consultor não encontrado")
    
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    
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
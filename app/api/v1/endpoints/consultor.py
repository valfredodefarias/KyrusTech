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
from app.api.v1.deps import get_consultor_user, get_current_active_user
from app.schemas.empresa import EmpresaRead
from pydantic import BaseModel

router = APIRouter()


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


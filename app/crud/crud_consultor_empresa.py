# app/crud/crud_consultor_empresa.py
"""
CRUD para gerenciar acesso de consultores a múltiplas empresas.
"""
from typing import Sequence
from sqlmodel import Session, select
from app.models.consultor_empresa import ConsultorEmpresa


def get_empresas_consultor(db: Session, usuario_id: int) -> Sequence[ConsultorEmpresa]:
    """Retorna todas as empresas que um consultor tem acesso (ativas)."""
    return db.exec(
        select(ConsultorEmpresa)
        .where(
            ConsultorEmpresa.usuario_id == usuario_id,
            ConsultorEmpresa.ativo == True
        )
    ).all()


def tem_acesso(db: Session, usuario_id: int, empresa_id: int) -> bool:
    """Verifica se um consultor tem acesso a uma empresa específica."""
    acesso = db.exec(
        select(ConsultorEmpresa)
        .where(
            ConsultorEmpresa.usuario_id == usuario_id,
            ConsultorEmpresa.empresa_id == empresa_id,
            ConsultorEmpresa.ativo == True
        )
    ).first()
    return acesso is not None


def adicionar_acesso(db: Session, usuario_id: int, empresa_id: int) -> ConsultorEmpresa:
    """Adiciona acesso de consultor a uma empresa."""
    acesso = ConsultorEmpresa(
        usuario_id=usuario_id,
        empresa_id=empresa_id,
        ativo=True
    )  # type: ignore[call-arg]
    db.add(acesso)
    db.commit()
    db.refresh(acesso)
    return acesso


def revogar_acesso(db: Session, usuario_id: int, empresa_id: int) -> bool:
    """Revoga acesso de consultor a uma empresa."""
    acesso = db.exec(
        select(ConsultorEmpresa)
        .where(
            ConsultorEmpresa.usuario_id == usuario_id,
            ConsultorEmpresa.empresa_id == empresa_id
        )
    ).first()
    
    if acesso:
        acesso.ativo = False
        db.add(acesso)
        db.commit()
        return True
    return False

"""
CRUD para integrações bancárias.
Gerencia criação, leitura, atualização e exclusão de integrações.
"""
from typing import List, Optional
from sqlmodel import Session, select
from datetime import datetime, timedelta
import json
from loguru import logger

from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.schemas.integracao_bancaria import IntegracaoBancariaCreate, IntegracaoBancariaUpdate
from app.core.encryption import encrypt_token, decrypt_token, encrypt_dict, decrypt_dict


def get_by_empresa(db: Session, *, empresa_id: int) -> List[IntegracaoBancaria]:
    """Busca todas as integrações de uma empresa."""
    statement = select(IntegracaoBancaria).where(
        IntegracaoBancaria.empresa_id == empresa_id
    ).order_by(IntegracaoBancaria.created_at.desc())
    return list(db.exec(statement).all())


def get(db: Session, *, id: int, empresa_id: int) -> Optional[IntegracaoBancaria]:
    """Busca uma integração específica."""
    statement = select(IntegracaoBancaria).where(
        IntegracaoBancaria.id == id,
        IntegracaoBancaria.empresa_id == empresa_id
    )
    return db.exec(statement).first()


def create(db: Session, *, obj_in: IntegracaoBancariaCreate, empresa_id: int) -> IntegracaoBancaria:
    """
    Cria uma nova integração bancária.
    Criptografa o token antes de salvar.
    """
    logger.info(f"Criando integração bancária: {obj_in.nome} (Tipo: {obj_in.tipo}) para empresa ID: {empresa_id}")
    
    # Criptografa o token
    token_criptografado = encrypt_token(obj_in.token)
    
    # Criptografa configuração adicional se houver
    config_criptografada = None
    if obj_in.configuracao_adicional:
        config_criptografada = encrypt_dict(obj_in.configuracao_adicional)
    
    # Cria o objeto
    db_obj = IntegracaoBancaria(
        nome=obj_in.nome,
        tipo=obj_in.tipo.upper(),
        ambiente=obj_in.ambiente.upper(),
        token_criptografado=token_criptografado,
        configuracao_adicional=config_criptografada,
        ativo=obj_in.ativo,
        sincronizar_automaticamente=obj_in.sincronizar_automaticamente,
        intervalo_sincronizacao_minutos=obj_in.intervalo_sincronizacao_minutos,
        categoria_padrao_id=obj_in.categoria_padrao_id,
        usar_categoria_a_categorizar=obj_in.usar_categoria_a_categorizar,
        conta_id=obj_in.conta_id,
        centro_custo_id=obj_in.centro_custo_id,
        empresa_id=empresa_id,
        updated_at=datetime.utcnow()
    )
    
    # Calcula próxima sincronização se automática
    if obj_in.sincronizar_automaticamente:
        db_obj.proxima_sincronizacao = datetime.utcnow() + timedelta(
            minutes=obj_in.intervalo_sincronizacao_minutos
        )
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    logger.success(f"Integração bancária criada com sucesso! ID: {db_obj.id}")
    return db_obj


def update(
    db: Session, 
    *, 
    db_obj: IntegracaoBancaria, 
    obj_in: IntegracaoBancariaUpdate
) -> IntegracaoBancaria:
    """
    Atualiza uma integração bancária.
    Se token for fornecido, será re-criptografado.
    """
    update_data = obj_in.model_dump(exclude_unset=True)
    
    # Se token foi fornecido, criptografa
    if "token" in update_data:
        logger.info(f"Atualizando token da integração ID: {db_obj.id}")
        update_data["token_criptografado"] = encrypt_token(update_data.pop("token"))
    
    # Se configuração adicional foi fornecida, criptografa
    if "configuracao_adicional" in update_data and update_data["configuracao_adicional"]:
        update_data["configuracao_adicional"] = encrypt_dict(update_data["configuracao_adicional"])
    
    # Atualiza campos
    for key, value in update_data.items():
        setattr(db_obj, key, value)
    
    db_obj.updated_at = datetime.utcnow()
    
    # Recalcula próxima sincronização se intervalo mudou
    if "intervalo_sincronizacao_minutos" in update_data and db_obj.sincronizar_automaticamente:
        db_obj.proxima_sincronizacao = datetime.utcnow() + timedelta(
            minutes=db_obj.intervalo_sincronizacao_minutos
        )
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    logger.success(f"Integração bancária atualizada! ID: {db_obj.id}")
    return db_obj


def delete(db: Session, *, id: int, empresa_id: int) -> Optional[IntegracaoBancaria]:
    """Remove uma integração bancária."""
    db_obj = get(db=db, id=id, empresa_id=empresa_id)
    if db_obj:
        logger.info(f"Removendo integração bancária ID: {id}")
        db.delete(db_obj)
        db.commit()
        logger.success(f"Integração bancária removida! ID: {id}")
    return db_obj


def get_token_decrypted(db: Session, *, integracao: IntegracaoBancaria) -> str:
    """
    Retorna o token descriptografado de uma integração.
    Use apenas quando necessário para fazer chamadas à API externa.
    """
    try:
        return decrypt_token(integracao.token_criptografado)
    except Exception as e:
        logger.error(f"Erro ao descriptografar token da integração ID: {integracao.id}: {e}")
        raise ValueError("Falha ao descriptografar token")


def atualizar_ultima_sincronizacao(
    db: Session, 
    *, 
    integracao: IntegracaoBancaria,
    sucesso: bool = True
) -> IntegracaoBancaria:
    """
    Atualiza o timestamp da última sincronização.
    Calcula a próxima sincronização se automática.
    """
    integracao.ultima_sincronizacao = datetime.utcnow()
    
    if integracao.sincronizar_automaticamente and sucesso:
        integracao.proxima_sincronizacao = datetime.utcnow() + timedelta(
            minutes=integracao.intervalo_sincronizacao_minutos
        )
    
    db.add(integracao)
    db.commit()
    db.refresh(integracao)
    
    return integracao




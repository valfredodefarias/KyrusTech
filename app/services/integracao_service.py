# app/services/integracao_service.py

from typing import List, Optional
from sqlmodel import Session, select
from fastapi import HTTPException, status
from datetime import datetime

# Models & Schemas
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.conta import Conta
from app.schemas.integracao import IntegracaoCreate, IntegracaoUpdate

# Serviço de Segurança
from app.services.security_service import SecurityService

class IntegracaoService:
    def __init__(self, session: Session):
        self.session = session
        self.security = SecurityService()

    def create(self, dados: IntegracaoCreate, empresa_id: int, user_id: int) -> IntegracaoBancaria:
        # 1. Verifica se a conta existe e pertence à empresa
        conta = self.session.get(Conta, dados.conta_id)
        if not conta or conta.empresa_id != empresa_id:
             raise HTTPException(status_code=404, detail="Conta bancária não encontrada.")

        # 2. Verifica se já existe integração para esta conta
        # (Regra: Uma conta só pode ter uma integração ativa)
        existente = self.session.exec(
            select(IntegracaoBancaria).where(
                IntegracaoBancaria.conta_id == dados.conta_id,
                IntegracaoBancaria.is_deleted == False
            )
        ).first()
        
        if existente:
            raise HTTPException(status_code=400, detail="Esta conta já possui uma integração configurada.")

        # 3. CRIPTOGRAFIA (O Pulo do Gato 🐈)
        token_seguro = self.security.encrypt(dados.token)

        # 4. Criação
        db_obj = IntegracaoBancaria(
            nome=dados.nome,
            provedor=dados.provedor,
            ambiente=dados.ambiente,
            ativo=dados.ativo,
            sincronizar_automaticamente=dados.sincronizar_automaticamente,
            
            # Salvamos o Criptografado, não o original
            token_criptografado=token_seguro,
            configuracao_adicional=dados.configuracao_adicional,
            
            conta_id=dados.conta_id,
            empresa_id=empresa_id,
            created_by_id=user_id,
            updated_by_id=user_id
        )
        
        # Atualiza a conta para saber que agora ela é integrada
        conta.tipo_integracao = dados.provedor # Ex: ASAAS
        self.session.add(conta)
        
        self.session.add(db_obj)
        self.session.commit()
        self.session.refresh(db_obj)
        return db_obj

    def get_token_descriptografado(self, integracao_id: int, empresa_id: int) -> str:
        """
        Método EXCLUSIVO para uso interno (Background Jobs).
        Nunca exponha isso em rotas de API pública.
        """
        integracao = self.get_by_id(integracao_id, empresa_id)
        return self.security.decrypt(integracao.token_criptografado)

    def get_by_id(self, id: int, empresa_id: int) -> IntegracaoBancaria:
        query = select(IntegracaoBancaria).where(
            IntegracaoBancaria.id == id,
            IntegracaoBancaria.empresa_id == empresa_id,
            IntegracaoBancaria.is_deleted == False
        )
        obj = self.session.exec(query).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Integração não encontrada.")
        return obj

    def listar(self, empresa_id: int) -> List[IntegracaoBancaria]:
        # Retorna a lista, mas o Schema de Leitura (IntegracaoRead) 
        # vai garantir que o campo 'token_criptografado' não apareça no JSON.
        query = select(IntegracaoBancaria).where(
            IntegracaoBancaria.empresa_id == empresa_id,
            IntegracaoBancaria.is_deleted == False
        )
        return list(self.session.exec(query).all())
    
    def delete(self, id: int, empresa_id: int, user_id: int):
        integracao = self.get_by_id(id, empresa_id)
        
        # Remove a marcação da conta
        conta = self.session.get(Conta, integracao.conta_id)
        if conta:
            conta.tipo_integracao = "MANUAL"
            self.session.add(conta)
            
        integracao.is_deleted = True
        integracao.deleted_at = datetime.utcnow()
        integracao.deleted_by_id = user_id
        
        self.session.add(integracao)
        self.session.commit()
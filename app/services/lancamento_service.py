# app/services/lancamento_service.py

from datetime import datetime, date
from typing import List, Optional
# IMPORTANTE: Adicione 'col', 'asc', 'desc' aqui
from sqlmodel import Session, select, func, asc, desc, col 
from fastapi import HTTPException, status

# Models
from app.models.lancamento import Lancamento
from app.models.anexo_lancamento import AnexoLancamento
from app.models.plano_contas import PlanoContas 
from app.models.conta import Conta

# Schemas 
from app.schemas.lancamento import (
    LancamentoCreate, 
    LancamentoUpdate, 
    BulkUpdateSchema, 
    TransferenciaCreate
)
from app.schemas.anexo import AnexoCreate

class LancamentoService:
    def __init__(self, session: Session):
        self.session = session

    def _calcular_status(self, data_pagamento: Optional[date], data_vencimento: date) -> str:
        if data_pagamento:
            return "PAGO"
        return "EM ABERTO"

    # --- Métodos CRUD Básicos ---

    def create(self, dados: LancamentoCreate, empresa_id: int, user_id: int) -> Lancamento:
        db_lancamento = Lancamento.from_orm(dados)
        db_lancamento.empresa_id = empresa_id
        db_lancamento.created_by_id = user_id
        db_lancamento.updated_by_id = user_id
        db_lancamento.status = self._calcular_status(db_lancamento.data_pagamento, db_lancamento.data_vencimento)

        self.session.add(db_lancamento)
        self.session.commit()
        self.session.refresh(db_lancamento)
        return db_lancamento

    def get_by_id(self, lancamento_id: int, empresa_id: int) -> Lancamento:
        query = select(Lancamento).where(
            Lancamento.id == lancamento_id,
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        lancamento = self.session.exec(query).first()
        if not lancamento:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")
        return lancamento

    def listar(self, empresa_id: int, skip: int = 0, limit: int = 100, data_inicio: Optional[date] = None, data_fim: Optional[date] = None) -> List[Lancamento]:
        query = select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        if data_inicio:
            query = query.where(Lancamento.data_vencimento >= data_inicio)
        if data_fim:
            query = query.where(Lancamento.data_vencimento <= data_fim)
            
        # CORREÇÃO DO ASC: Usando asc() como função, não método
        query = query.offset(skip).limit(limit).order_by(asc(Lancamento.data_vencimento))
        
        # CORREÇÃO DO RETORNO: Convertendo para list()
        return list(self.session.exec(query).all())

    def update(self, lancamento_id: int, dados_atualizacao: LancamentoUpdate, empresa_id: int, user_id: int) -> Lancamento:
        db_lancamento = self.get_by_id(lancamento_id, empresa_id)
        dados_dict = dados_atualizacao.dict(exclude_unset=True)
        
        for key, value in dados_dict.items():
            setattr(db_lancamento, key, value)

        if "data_pagamento" in dados_dict or "data_vencimento" in dados_dict:
            db_lancamento.status = self._calcular_status(db_lancamento.data_pagamento, db_lancamento.data_vencimento)

        db_lancamento.updated_by_id = user_id
        db_lancamento.updated_at = datetime.utcnow()

        self.session.add(db_lancamento)
        self.session.commit()
        self.session.refresh(db_lancamento)
        return db_lancamento

    def delete(self, lancamento_id: int, empresa_id: int, user_id: int):
        lancamento = self.get_by_id(lancamento_id, empresa_id)
        lancamento.is_deleted = True
        lancamento.deleted_at = datetime.utcnow()
        lancamento.deleted_by_id = user_id
        self.session.add(lancamento)
        self.session.commit()

    # --- Gestão de Anexos ---
    def adicionar_anexo(self, lancamento_id: int, dados_anexo: AnexoCreate, empresa_id: int, user_id: int) -> AnexoLancamento:
        self.get_by_id(lancamento_id, empresa_id) 
        novo_anexo = AnexoLancamento.from_orm(dados_anexo)
        novo_anexo.lancamento_id = lancamento_id
        novo_anexo.empresa_id = empresa_id
        novo_anexo.created_by_id = user_id
        
        self.session.add(novo_anexo)
        self.session.commit()
        self.session.refresh(novo_anexo)
        return novo_anexo
    
    # --- MÉTODOS BULK ---

    def criar_em_massa(self, lista_dados: List[LancamentoCreate], empresa_id: int, user_id: int) -> List[Lancamento]:
        novos_objetos = []
        for dados in lista_dados:
            obj = Lancamento.from_orm(dados)
            obj.empresa_id = empresa_id
            obj.created_by_id = user_id
            obj.updated_by_id = user_id
            obj.status = self._calcular_status(obj.data_pagamento, obj.data_vencimento)
            self.session.add(obj)
            novos_objetos.append(obj)
        
        self.session.commit()
        for obj in novos_objetos:
            self.session.refresh(obj)
        return novos_objetos

    def deletar_em_massa(self, ids: List[int], empresa_id: int, user_id: int):
        # CORREÇÃO DO IN_: Usando col() para evitar erro de tipo
        statement = select(Lancamento).where(
            col(Lancamento.id).in_(ids),
            Lancamento.empresa_id == empresa_id
        )
        lancamentos = self.session.exec(statement).all()
        for lanc in lancamentos:
            lanc.is_deleted = True
            lanc.deleted_at = datetime.utcnow()
            lanc.deleted_by_id = user_id
            self.session.add(lanc)
        self.session.commit()

    def baixar_em_massa(self, ids: List[int], data_pagamento: date, conta_id: Optional[int], empresa_id: int, user_id: int) -> int:
        # CORREÇÃO DO IN_: Usando col()
        statement = select(Lancamento).where(
            col(Lancamento.id).in_(ids),
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        lancamentos = self.session.exec(statement).all()
        count = 0
        data_efetiva = data_pagamento or date.today()

        for lanc in lancamentos:
            lanc.status = "PAGO"
            lanc.data_pagamento = data_efetiva
            if conta_id:
                lanc.conta_id = conta_id
            if not lanc.valor_pago:
                lanc.valor_pago = lanc.valor_previsto
            lanc.updated_by_id = user_id
            lanc.updated_at = datetime.utcnow()
            self.session.add(lanc)
            count += 1
            
        self.session.commit()
        return count

    def atualizar_em_massa(self, payload: BulkUpdateSchema, empresa_id: int, user_id: int) -> dict:
        # CORREÇÃO DO IN_: Usando col()
        statement = select(Lancamento).where(
            col(Lancamento.id).in_(payload.ids),
            Lancamento.empresa_id == empresa_id
        )
        lancamentos = self.session.exec(statement).all()
        
        sucesso = 0
        erros = []
        dados_dict = payload.dict(exclude={"ids"}, exclude_unset=True)

        for lanc in lancamentos:
            try:
                for key, value in dados_dict.items():
                    if key == "data_pagamento" and value is not None:
                         lanc.status = "PAGO"
                         if not lanc.valor_pago:
                             lanc.valor_pago = lanc.valor_previsto
                    setattr(lanc, key, value)
                
                lanc.updated_by_id = user_id
                self.session.add(lanc)
                sucesso += 1
            except Exception as e:
                erros.append(f"Erro ID {lanc.id}: {str(e)}")
        
        self.session.commit()
        return {"sucesso": True, "atualizados": sucesso, "erros": erros}

    def transferir(self, dados: TransferenciaCreate, empresa_id: int, user_id: int):
        # 1. Busca os Nomes das Contas (Origem e Destino)
        conta_origem = self.session.get(Conta, dados.conta_origem_id)
        conta_destino = self.session.get(Conta, dados.conta_destino_id)

        if not conta_origem or not conta_destino:
            raise HTTPException(status_code=404, detail="Conta de origem ou destino não encontrada.")

        descricao_transf = f"Transf de {conta_origem.nome} para {conta_destino.nome}"

        # 2. Validação/Busca da Categoria
        # Se o Schema estiver certo, aqui não pode dar erro de 'categoria_id'
        categoria_id = dados.categoria_id 
        if not categoria_id:
            cat_padrao = self.session.exec(
                select(PlanoContas).where(PlanoContas.empresa_id == empresa_id).limit(1)
            ).first()
            if cat_padrao:
                categoria_id = cat_padrao.id
            else:
                 raise HTTPException(status_code=400, detail="Crie pelo menos um Plano de Contas antes de transferir.")

        saida = Lancamento(
            descricao=descricao_transf,
            tipo="DESPESA",
            valor_previsto=dados.valor,
            valor_pago=dados.valor,
            data_vencimento=dados.data,
            data_pagamento=dados.data,
            data_competencia=dados.data,
            conta_id=dados.conta_origem_id,
            status="PAGO",
            origem="TRANSFERENCIA",
            empresa_id=empresa_id,
            plano_contas_id=categoria_id, 
            created_by_id=user_id,
            observacao=dados.observacao
        )
        
        entrada = Lancamento(
            descricao=descricao_transf,
            tipo="RECEITA",
            valor_previsto=dados.valor,
            valor_pago=dados.valor,
            data_vencimento=dados.data,
            data_pagamento=dados.data,
            data_competencia=dados.data,
            conta_id=dados.conta_destino_id,
            status="PAGO",
            origem="TRANSFERENCIA",
            empresa_id=empresa_id,
            plano_contas_id=categoria_id,
            created_by_id=user_id,
            observacao=dados.observacao
        )

        self.session.add(saida)
        self.session.add(entrada)
        self.session.commit()
        return {"msg": "Transferência realizada", "ids": [saida.id, entrada.id]}
# app/crud/crud_lancamento.py

from typing import List, Optional
import datetime # Importante para conversão de datas
from sqlmodel import Session, select, col

# Importamos os Modelos
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade
from app.models.conta import Conta
from app.models.cartao import Cartao
from app.models.plano_contas import PlanoContas
from app.schemas.lancamento import TransferenciaCreate 

# Importamos os Schemas
from app.schemas.lancamento import LancamentoCreate, LancamentoRead, LancamentoUpdate

def get_by_empresa(db: Session, *, empresa_id: int, skip: int = 0, limit: int = 2000) -> List[LancamentoRead]:
    """
    Busca lançamentos fazendo JOIN com tabelas relacionadas para trazer os nomes.
    """
    # Adicionamos '# type: ignore' no final do select para silenciar o Pylance,
    # pois ele se confunde com retornos mistos (Modelo + Colunas), mas o SQLAlchemy aceita.
    statement = (
        select(
            Lancamento, 
            Entidade.nome, 
            Conta.nome,
            Cartao.nome_cartao, 
            PlanoContas.nome
        ) # type: ignore
        .outerjoin(Entidade, Lancamento.entidade_id == Entidade.id)
        .outerjoin(Conta, Lancamento.conta_id == Conta.id)
        .outerjoin(Cartao, Lancamento.cartao_id == Cartao.id)
        .join(PlanoContas, Lancamento.plano_contas_id == PlanoContas.id)
        .where(Lancamento.empresa_id == empresa_id)
        .order_by(Lancamento.data_vencimento)
        .offset(skip)
        .limit(limit)
    )
    
    results = db.exec(statement).all()
    
    lista_retorno = []
    for row in results:
        # Desempacotamos a tupla retornada pelo select
        lancamento, nome_ent, nome_conta, nome_cart, nome_cat = row
        
        # Convertemos o modelo para o schema
        item = LancamentoRead.model_validate(lancamento)
        
        # Injetamos os nomes virtuais para o Frontend exibir
        item.nome_entidade = nome_ent
        item.nome_conta = nome_conta
        item.nome_cartao = nome_cart
        item.nome_plano_contas = nome_cat
        
        lista_retorno.append(item)
        
    return lista_retorno

def create_lancamento(db: Session, *, obj_in: LancamentoCreate, empresa_id: int) -> Lancamento:
    if not obj_in.data_competencia:
        obj_in.data_competencia = obj_in.data_vencimento
        
    db_obj = Lancamento.model_validate(obj_in, update={"empresa_id": empresa_id})
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update_lancamento(db: Session, *, id: int, obj_in: LancamentoUpdate, empresa_id: int) -> Optional[Lancamento]:
    db_obj = db.get(Lancamento, id)
    if not db_obj or db_obj.empresa_id != empresa_id:
        return None
    
    update_data = obj_in.model_dump(exclude_unset=True)
    db_obj.sqlmodel_update(update_data)
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

# --- OPERAÇÕES EM MASSA (BULK) ---

def create_multi(db: Session, *, list_obj_in: List[LancamentoCreate], empresa_id: int):
    objetos = []
    for obj_in in list_obj_in:
        if not obj_in.data_competencia:
            obj_in.data_competencia = obj_in.data_vencimento
            
        db_obj = Lancamento.model_validate(obj_in, update={"empresa_id": empresa_id})
        db.add(db_obj)
        objetos.append(db_obj)
    
    db.commit()
    for obj in objetos: db.refresh(obj)
    return objetos

def delete_multi(db: Session, *, ids: List[int], empresa_id: int):
    statement = select(Lancamento).where(
        col(Lancamento.id).in_(ids),
        Lancamento.empresa_id == empresa_id
    )
    results = db.exec(statement).all()
    
    qtd = 0
    for item in results:
        db.delete(item)
        qtd += 1
    
    db.commit()
    return {"ok": True, "deleted": qtd}

def pay_multi(db: Session, *, ids: List[int], data_pagamento: str, empresa_id: int):
    """Baixa (paga) múltiplos lançamentos."""
    statement = select(Lancamento).where(
        col(Lancamento.id).in_(ids),
        Lancamento.empresa_id == empresa_id
    )
    results = db.exec(statement).all()
    
    qtd = 0
    for item in results:
        if item.status != "PAGO":
            item.status = "PAGO"
            
            # CORREÇÃO: Converte a string 'YYYY-MM-DD' para date real antes de salvar
            if isinstance(data_pagamento, str):
                item.data_pagamento = datetime.date.fromisoformat(data_pagamento)
            else:
                item.data_pagamento = data_pagamento
            
            # Se não tiver valor pago, assume o valor previsto
            if not item.valor_pago or item.valor_pago == 0:
                item.valor_pago = item.valor_previsto
                
            db.add(item)
            qtd += 1
            
    db.commit()
    return {"ok": True, "updated": qtd}





def realizar_transferencia(db: Session, *, transf_in: TransferenciaCreate, empresa_id: int):
    """
    Realiza a transferência criando dois lançamentos atômicos:
    1. Despesa na conta de origem.
    2. Receita na conta de destino.
    """
    # 1. Cria a Saída (Despesa)
    saida = Lancamento(
        descricao=f"Transferência para conta ID {transf_in.conta_destino_id}",
        tipo="DESPESA",
        valor_previsto=transf_in.valor,
        valor_pago=transf_in.valor, # Já nasce pago/efetivado
        data_vencimento=transf_in.data_transferencia,
        data_pagamento=transf_in.data_transferencia,
        data_competencia=transf_in.data_transferencia,
        status="PAGO",
        conta_id=transf_in.conta_origem_id,
        plano_contas_id=transf_in.categoria_saida_id,
        empresa_id=empresa_id,
        observacao=transf_in.observacao,
        origem="TRANSFERENCIA"
    )
    db.add(saida)

    # 2. Cria a Entrada (Receita)
    entrada = Lancamento(
        descricao=f"Transferência recebida da conta ID {transf_in.conta_origem_id}",
        tipo="RECEITA",
        valor_previsto=transf_in.valor,
        valor_pago=transf_in.valor, # Já nasce pago/efetivado
        data_vencimento=transf_in.data_transferencia,
        data_pagamento=transf_in.data_transferencia,
        data_competencia=transf_in.data_transferencia,
        status="PAGO",
        conta_id=transf_in.conta_destino_id,
        plano_contas_id=transf_in.categoria_entrada_id,
        empresa_id=empresa_id,
        observacao=transf_in.observacao,
        origem="TRANSFERENCIA"
    )
    db.add(entrada)

    # O commit salva os dois. Se um falhar, nenhum é salvo.
    db.commit()
    
    db.refresh(saida)
    db.refresh(entrada)
    
    return {"ok": True, "saida_id": saida.id, "entrada_id": entrada.id}
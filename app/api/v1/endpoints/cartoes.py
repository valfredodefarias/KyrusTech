from typing import List, Any
from decimal import Decimal

from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from loguru import logger

from app.db.session import get_session
from app.models.usuario import Usuario
from app.models.cartao import Cartao
from app.models.lancamento import Lancamento
from app.schemas.cartao import CartaoCreate, CartaoRead, CartaoResumoRead, CartaoUpdate
from app.api.deps import get_current_user, require_permission

router = APIRouter()

@router.get("/", response_model=List[CartaoRead])
def read_cartoes(
    skip: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    # Retorna APENAS cartões da empresa do usuário
    query = select(Cartao).where(Cartao.empresa_id == current_user.empresa_id).order_by(Cartao.nome_cartao)
    query = query.offset(skip).limit(limit)
    return session.exec(query).all()


@router.get("/resumo", response_model=List[CartaoResumoRead])
def read_cartoes_resumo(
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    cartoes = session.exec(
        select(Cartao)
        .where(Cartao.empresa_id == current_user.empresa_id)
        .order_by(Cartao.nome_cartao)
    ).all()

    if not cartoes:
        return []

    pendencias_rows = session.exec(
        select(
            Lancamento.cartao_id,
            func.coalesce(func.sum(Lancamento.valor_previsto), 0),
        )
        .where(
            Lancamento.empresa_id == current_user.empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.cartao_id.is_not(None),
            Lancamento.status != "PAGO",
        )
        .group_by(Lancamento.cartao_id)
    ).all()

    gastos_por_cartao = {
        int(cartao_id): Decimal(str(valor or 0))
        for cartao_id, valor in pendencias_rows
        if cartao_id is not None
    }

    resultado: list[dict[str, Any]] = []
    for cartao in cartoes:
        cartao_read = CartaoRead.model_validate(cartao).model_dump()
        gastos_pendentes = gastos_por_cartao.get(int(cartao.id or 0), Decimal("0.00"))
        cartao_read["gastos_pendentes"] = gastos_pendentes
        cartao_read["saldo_disponivel"] = Decimal(str(cartao.limite_total or 0)) - gastos_pendentes
        resultado.append(cartao_read)

    return resultado

@router.post(
    "/",
    response_model=CartaoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("cartoes:create"))],
)
def create_cartao(
    cartao_in: CartaoCreate,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    logger.info(f"Criando cartão: '{cartao_in.nome_cartao}'")
    
    # 1. Converte para dicionário
    dados = cartao_in.dict()
    
    # 2. Corrige nomes (Schema -> Banco)
    if 'conta_pagamento_id' in dados:
        dados['conta_id'] = dados.pop('conta_pagamento_id')
    if 'limite' in dados:
        dados['limite_total'] = dados.pop('limite')

    try:
        # 3. Cria objeto e força empresa_id do TOKEN (Segurança)
        novo_cartao = Cartao(**dados)
        novo_cartao.empresa_id = current_user.empresa_id
        
        session.add(novo_cartao)
        session.commit()
        session.refresh(novo_cartao)
        return novo_cartao
    except Exception as e:
        logger.error(f"Erro create: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao salvar: {str(e)}")

@router.put(
    "/{cartao_id}",
    response_model=CartaoRead,
    dependencies=[Depends(require_permission("cartoes:update"))],
)
def update_cartao(
    cartao_id: int,
    cartao_in: CartaoUpdate,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    # 1. Busca Segura (Anti-IDOR)
    query = select(Cartao).where(
        Cartao.id == cartao_id, 
        Cartao.empresa_id == current_user.empresa_id
    )
    cartao = session.exec(query).first()

    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")

    # 2. Prepara atualização
    dados_update = cartao_in.dict(exclude_unset=True)

    # 3. Corrige nomes (Schema -> Banco)
    if 'conta_pagamento_id' in dados_update:
        dados_update['conta_id'] = dados_update.pop('conta_pagamento_id')
    if 'limite' in dados_update:
        dados_update['limite_total'] = dados_update.pop('limite')

    try:
        # 4. Atualiza APENAS campos que existem no Model (Evita erro 500)
        for key, value in dados_update.items():
            if hasattr(cartao, key):
                setattr(cartao, key, value)
        
        session.add(cartao)
        session.commit()
        session.refresh(cartao)
        return cartao
    except Exception as e:
        logger.error(f"Erro update: {e}")
        raise HTTPException(status_code=500, detail="Erro interno na atualização.")

@router.delete(
    "/{cartao_id}",
    dependencies=[Depends(require_permission("cartoes:delete"))],
)
def delete_cartao(
    cartao_id: int,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    cartao = session.exec(select(Cartao).where(
        Cartao.id == cartao_id,
        Cartao.empresa_id == current_user.empresa_id
    )).first()

    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")

    session.delete(cartao)
    session.commit()
    return {"ok": True}
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
from app.models.lancamento_cartao import LancamentoCartao
from app.schemas.cartao import CartaoCreate, CartaoRead, CartaoResumoRead, CartaoUpdate
from app.schemas.lancamento_cartao import LancamentoCartaoCreate, LancamentoCartaoUpdate, LancamentoCartaoRead
from app.api.deps import get_current_user, require_permission
from app.services.fatura_cartao_service import pagar_fatura, calcular_vencimento_fatura, avancar_meses_fatura
from datetime import date
import uuid
import pandas as pd
import io
from fastapi import File, UploadFile
from pydantic import BaseModel

class PagarFaturaRequest(BaseModel):
    cartao_id: int
    competencia_fatura: str
    conta_pagamento_id: int
    data_pagamento: date

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


@router.post(
    "/pagar-fatura",
    dependencies=[Depends(require_permission("lancamentos:update"))],
)
def endpoint_pagar_fatura(
    req: PagarFaturaRequest,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    empresa_id = current_user.empresa_id
    user_id = current_user.id
    
    try:
        novos_lancamentos = pagar_fatura(
            session=session,
            empresa_id=empresa_id,
            cartao_id=req.cartao_id,
            competencia_fatura=req.competencia_fatura,
            conta_pagamento_id=req.conta_pagamento_id,
            data_pagamento=req.data_pagamento
        )
        
        from app.websockets.manager import broadcast_sync
        from app.core.cache import clear_transaction_cache
        clear_transaction_cache(empresa_id)
        for lanc in novos_lancamentos:
            broadcast_sync(empresa_id, 'LANCAMENTO_CREATED', {'id': lanc.id})
            
        return {"msg": f"Fatura paga com sucesso. {len(novos_lancamentos)} lançamentos gerados no financeiro."}
    except Exception as e:
        logger.error(f"Erro ao pagar fatura: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/{cartao_id}/faturas/{competencia_fatura}",
    dependencies=[Depends(require_permission("lancamentos:delete"))],
)
def excluir_fatura_cartao(
    cartao_id: int,
    competencia_fatura: str,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    """ Exclui (soft-delete) todas as despesas abertas de uma fatura de cartão específica """
    empresa_id = current_user.empresa_id
    despesas = session.exec(
        select(LancamentoCartao).where(
            LancamentoCartao.cartao_id == cartao_id,
            LancamentoCartao.competencia_fatura == competencia_fatura,
            LancamentoCartao.empresa_id == empresa_id,
            LancamentoCartao.deleted_at.is_(None)
        )
    ).all()
    
    if not despesas:
        raise HTTPException(status_code=404, detail="Nenhuma despesa encontrada para esta fatura.")
        
    pago = [d for d in despesas if d.fatura_paga]
    if pago:
        raise HTTPException(status_code=400, detail="Não é possível excluir uma fatura que já foi paga.")
        
    import datetime
    now = datetime.datetime.utcnow()
    for d in despesas:
        d.deleted_at = now
        session.add(d)
        
    session.commit()
    
    from app.core.cache import clear_transaction_cache
    from app.websockets.manager import broadcast_sync
    clear_transaction_cache(empresa_id)
    broadcast_sync(empresa_id, 'LANCAMENTO_DELETED', {'cartao_id': cartao_id, 'competencia_fatura': competencia_fatura})
    
    return {"ok": True, "removidos": len(despesas)}


# ==========================================
# CRUD DE LANCAMENTOS DE CARTÃO
# ==========================================

@router.get("/{cartao_id}/lancamentos", response_model=List[LancamentoCartaoRead])
def get_lancamentos_cartao(
    cartao_id: int,
    competencia_fatura: str = None,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    """ Lista os lançamentos de um cartão específico, opcionalmente filtrando por fatura """
    empresa_id = current_user.empresa_id
    
    query = select(LancamentoCartao).where(
        LancamentoCartao.cartao_id == cartao_id,
        LancamentoCartao.empresa_id == empresa_id,
        LancamentoCartao.deleted_at.is_(None)
    ).order_by(LancamentoCartao.data_compra)
    
    if competencia_fatura:
        query = query.where(LancamentoCartao.competencia_fatura == competencia_fatura)
        
    return session.exec(query).all()


@router.post("/{cartao_id}/lancamentos", response_model=List[LancamentoCartaoRead], status_code=status.HTTP_201_CREATED)
def create_lancamento_cartao(
    cartao_id: int,
    lancamento_in: LancamentoCartaoCreate,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    """ 
    Cria um ou mais lançamentos no cartão.
    Se quantidade_parcelas > 1, gera as próximas faturas automaticamente.
    """
    empresa_id = current_user.empresa_id
    
    cartao = session.exec(select(Cartao).where(Cartao.id == cartao_id, Cartao.empresa_id == empresa_id)).first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
        
    resultados = []
    
    # Determina a data de vencimento da primeira parcela
    # Se o front mandou uma competencia específica inicial, a gente respeita, senão calcula
    # Por simplicidade de regra, vamos sempre calcular a partir da data da compra ou 
    # usar a competencia inicial para "empurrar"
    
    base_vencimento = calcular_vencimento_fatura(
        lancamento_in.data_compra, 
        cartao.dia_fechamento or 1, 
        cartao.dia_vencimento or 10
    )
    
    # Se o frontend mandou jogar pra outra competencia, a gente ajusta a base_vencimento pra cair lá
    if lancamento_in.competencia_fatura_inicial:
        y, m = map(int, lancamento_in.competencia_fatura_inicial.split('-'))
        # Garante que o vencimento cai no ano e mes da fatura solicitada
        base_vencimento = date(y, m, base_vencimento.day)
    
    id_parcelamento = str(uuid.uuid4()) if lancamento_in.quantidade_parcelas > 1 else None
    
    qtd = max(1, lancamento_in.quantidade_parcelas)
    if lancamento_in.tipo_valor == "TOTAL":
        total_centavos = int(round(lancamento_in.valor * Decimal("100")))
        base_centavos = total_centavos // qtd
        diferenca_centavos = total_centavos - (base_centavos * qtd)
    else:
        base_centavos = int(round(lancamento_in.valor * Decimal("100")))
        diferenca_centavos = 0
    
    for i in range(qtd):
        if lancamento_in.tipo_valor == "TOTAL":
            val_centavos = (base_centavos + diferenca_centavos) if i == 0 else base_centavos
        else:
            val_centavos = base_centavos
        valor_parcela = Decimal(val_centavos) / Decimal("100")

        # Avança o mes conforme a parcela
        vencimento_parcela = avancar_meses_fatura(base_vencimento, i, cartao.dia_vencimento or 10)
        competencia = f"{vencimento_parcela.year}-{str(vencimento_parcela.month).zfill(2)}"
        
        novo_lanc = LancamentoCartao(
            empresa_id=empresa_id,
            cartao_id=cartao_id,
            descricao=lancamento_in.descricao,
            valor=valor_parcela,
            data_compra=lancamento_in.data_compra,
            data_vencimento_fatura=vencimento_parcela,
            competencia_fatura=competencia,
            plano_contas_id=lancamento_in.plano_contas_id,
            centro_custo_id=lancamento_in.centro_custo_id,
            entidade_id=lancamento_in.entidade_id,
            observacao=lancamento_in.observacao,
            numero_parcela=(i + 1) if qtd > 1 else None,
            id_parcelamento=id_parcelamento,
            fatura_paga=False,
            regime_competencia=lancamento_in.regime_competencia
        )
        session.add(novo_lanc)
        resultados.append(novo_lanc)
        
    session.commit()
    for r in resultados:
        session.refresh(r)
        
    return resultados


@router.put("/lancamentos/{id}", response_model=LancamentoCartaoRead)
def update_lancamento_cartao(
    id: int,
    lancamento_in: LancamentoCartaoUpdate,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    empresa_id = current_user.empresa_id
    
    lanc = session.exec(select(LancamentoCartao).where(
        LancamentoCartao.id == id,
        LancamentoCartao.empresa_id == empresa_id,
        LancamentoCartao.deleted_at.is_(None)
    )).first()
    
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
        
    if lanc.fatura_paga:
        raise HTTPException(status_code=400, detail="Não é possível editar um lançamento de uma fatura já paga.")
        
    update_data = lancamento_in.dict(exclude_unset=True)
    
    for key, value in update_data.items():
        setattr(lanc, key, value)
        
    # Se mudou a data da compra, deve recalcular a competencia/vencimento? 
    # Por enquanto, mantemos a mesma competencia para evitar mover as coisas de fatura sem querer,
    # ou podemos recalcular se o usuário quiser. Vamos manter simples: não recalcula.
        
    session.add(lanc)
    session.commit()
    session.refresh(lanc)
    return lanc


@router.delete("/lancamentos/{id}")
def delete_lancamento_cartao(
    id: int,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    empresa_id = current_user.empresa_id
    
    lanc = session.exec(select(LancamentoCartao).where(
        LancamentoCartao.id == id,
        LancamentoCartao.empresa_id == empresa_id,
        LancamentoCartao.deleted_at.is_(None)
    )).first()
    
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
        
    if lanc.fatura_paga:
        raise HTTPException(status_code=400, detail="Não é possível excluir um lançamento de uma fatura já paga.")
        
    import datetime
    lanc.deleted_at = datetime.datetime.utcnow()
    session.add(lanc)
    session.commit()
    
    return {"ok": True}


@router.post("/upload-xlsx")
async def upload_xlsx(
    file: UploadFile = File(...),
    current_user: Usuario = Depends(get_current_user)
) -> Any:
    """ Lê um arquivo XLSX e retorna as colunas e os dados para o frontend fazer o De-Para """
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        df = df.fillna("")
        
        # Converte datetime para string formato ISO para não quebrar JSON
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime('%Y-%m-%d')
                
        columns = list(df.columns)
        rows = df.to_dict(orient="records")
        return {"columns": columns, "rows": rows}
    except Exception as e:
        logger.error(f"Erro ao ler XLSX: {e}")
        raise HTTPException(status_code=400, detail="Não foi possível ler o arquivo Excel. Verifique o formato.")


class LancamentoCartaoBulkCreate(BaseModel):
    lancamentos: List[LancamentoCartaoCreate]

@router.post("/{cartao_id}/lancamentos/bulk", response_model=List[LancamentoCartaoRead], status_code=status.HTTP_201_CREATED)
def bulk_create_lancamento_cartao(
    cartao_id: int,
    req: LancamentoCartaoBulkCreate,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
) -> Any:
    """ Insere múltiplos lançamentos de uma vez (usado na importação XLSX) """
    resultados = []
    for lanc in req.lancamentos:
        # Reutiliza a lógica existente, chamando a função interna (mas sem criar nested requests)
        # Vamos apenas extrair a lógica central de create:
        res = create_lancamento_cartao(
            cartao_id=cartao_id, 
            lancamento_in=lanc, 
            session=session, 
            current_user=current_user
        )
        resultados.extend(res)
    return resultados
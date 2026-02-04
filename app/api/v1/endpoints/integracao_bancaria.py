"""
Endpoints para gerenciar integrações bancárias.
Permite configurar, listar, atualizar e sincronizar integrações.
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session
from loguru import logger
from typing import List, Optional

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user
from app.crud import crud_integracao_bancaria
from app.schemas.integracao_bancaria import (
    IntegracaoBancariaCreate,
    IntegracaoBancariaUpdate,
    IntegracaoBancariaRead,
    MapeamentoCategoriaCreate,
    MapeamentoCategoriaRead
)
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.models.plano_contas import PlanoContas
from sqlmodel import select
from app.services.integracao_asaas import (
    buscar_cobrancas_asaas,
    buscar_assinaturas_asaas
)

router = APIRouter()


@router.get("/", response_model=List[IntegracaoBancariaRead])
def listar_integracoes(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Lista todas as integrações bancárias da empresa.
    """
    logger.info(f"Listando integrações bancárias da empresa ID: {empresa_id}")
    integracoes = crud_integracao_bancaria.get_by_empresa(db=db, empresa_id=empresa_id)
    return integracoes


@router.get("/{integracao_id}", response_model=IntegracaoBancariaRead)
def obter_integracao(
    integracao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Obtém detalhes de uma integração específica.
    """
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    return integracao


@router.post("/", response_model=IntegracaoBancariaRead, status_code=201)
def criar_integracao(
    integracao_in: IntegracaoBancariaCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Cria uma nova integração bancária.
    O token será criptografado antes de ser salvo.
    """
    logger.info(f"Criando integração bancária: {integracao_in.nome} (Tipo: {integracao_in.tipo})")
    
    # Valida tipo
    tipos_validos = ["ASAAS", "ITAU", "NUBANK", "INTER", "SANTANDER"]
    if integracao_in.tipo.upper() not in tipos_validos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo inválido. Tipos válidos: {', '.join(tipos_validos)}"
        )
    
    if integracao_in.tipo.upper() == "ASAAS" and integracao_in.ambiente.upper() != "PRODUCAO":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integrações Asaas só são permitidas em PRODUCAO."
        )

    integracao = crud_integracao_bancaria.create(
        db=db,
        obj_in=integracao_in,
        empresa_id=empresa_id
    )
    
    logger.success(f"Integração bancária criada com sucesso! ID: {integracao.id}")
    return integracao


@router.patch("/{integracao_id}", response_model=IntegracaoBancariaRead)
def atualizar_integracao(
    integracao_id: int,
    integracao_in: IntegracaoBancariaUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Atualiza uma integração bancária.
    Se token for fornecido, será re-criptografado.
    """
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    
    if integracao.tipo.upper() == "ASAAS" and integracao_in.ambiente and integracao_in.ambiente.upper() != "PRODUCAO":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integrações Asaas só são permitidas em PRODUCAO."
        )

    integracao = crud_integracao_bancaria.update(
        db=db,
        db_obj=integracao,
        obj_in=integracao_in
    )
    
    return integracao


@router.delete("/{integracao_id}", status_code=204)
def deletar_integracao(
    integracao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Remove uma integração bancária.
    """
    integracao = crud_integracao_bancaria.delete(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    return None


@router.post("/{integracao_id}/sincronizar")
def sincronizar_integracao(
    integracao_id: int,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Sincroniza uma integração bancária.
    Busca lançamentos do sistema externo e cria/atualiza no sistema.
    """
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    
    if not integracao.ativo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integração está inativa"
        )
    
    # Sincroniza conforme o tipo
    if integracao.tipo.upper() == "ASAAS":
        from app.services.integracao_asaas import sincronizar_asaas
        resultado = sincronizar_asaas(
            db=db,
            integracao=integracao,
            data_inicio=data_inicio,
            data_fim=data_fim
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Sincronização para tipo {integracao.tipo} ainda não implementada"
        )
    
    return resultado


@router.get("/{integracao_id}/mapeamentos", response_model=List[MapeamentoCategoriaRead])
def listar_mapeamentos(
    integracao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Lista mapeamentos de categorias de uma integração.
    """
    # Verifica se integração existe e pertence à empresa
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    
    mapeamentos = db.exec(
        select(MapeamentoCategoria).where(
            MapeamentoCategoria.integracao_id == integracao_id
        )
    ).all()
    
    resultado = []
    for mapeamento in mapeamentos:
        plano_contas = db.get(PlanoContas, mapeamento.plano_contas_id)
        resultado.append({
            "id": mapeamento.id,  # Adiciona ID para poder deletar
            "categoria_externa": mapeamento.categoria_externa,
            "plano_contas_id": mapeamento.plano_contas_id,
            "plano_contas_nome": plano_contas.nome if plano_contas else None
        })
    
    return resultado


@router.post("/{integracao_id}/mapeamentos", response_model=MapeamentoCategoriaRead, status_code=201)
def criar_mapeamento(
    integracao_id: int,
    mapeamento_in: MapeamentoCategoriaCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Cria um mapeamento de categoria para uma integração.
    """
    # Verifica se integração existe e pertence à empresa
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    
    # Verifica se categoria existe
    plano_contas = db.get(PlanoContas, mapeamento_in.plano_contas_id)
    if not plano_contas or plano_contas.empresa_id != empresa_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria não encontrada"
        )
    
    # Verifica se mapeamento já existe
    mapeamento_existente = db.exec(
        select(MapeamentoCategoria).where(
            MapeamentoCategoria.integracao_id == integracao_id,
            MapeamentoCategoria.categoria_externa == mapeamento_in.categoria_externa
        )
    ).first()
    
    if mapeamento_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mapeamento já existe para esta categoria externa"
        )
    
    # Cria mapeamento
    mapeamento = MapeamentoCategoria(
        categoria_externa=mapeamento_in.categoria_externa,
        plano_contas_id=mapeamento_in.plano_contas_id,
        integracao_id=integracao_id
    )
    db.add(mapeamento)
    db.commit()
    db.refresh(mapeamento)
    
    return {
        "categoria_externa": mapeamento.categoria_externa,
        "plano_contas_id": mapeamento.plano_contas_id,
        "plano_contas_nome": plano_contas.nome
    }


@router.delete("/{integracao_id}/mapeamentos/{mapeamento_id}", status_code=204)
def deletar_mapeamento(
    integracao_id: int,
    mapeamento_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Remove um mapeamento de categoria.
    """
    # Verifica se integração existe e pertence à empresa
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    
    mapeamento = db.get(MapeamentoCategoria, mapeamento_id)
    if not mapeamento or mapeamento.integracao_id != integracao_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapeamento não encontrado"
        )
    
    db.delete(mapeamento)
    db.commit()
    return None


@router.get("/{integracao_id}/tipos-asaas")
def listar_tipos_asaas(
    integracao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Lista tipos disponíveis do Asaas para mapeamento.
    Retorna lista de tipos que podem ser mapeados para categorias.
    """
    # Verifica se integração existe e pertence à empresa
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração não encontrada"
        )
    
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta integração não é do tipo Asaas"
        )
    
    # Lista de tipos do Asaas baseada na documentação
    tipos_asaas = [
        {"codigo": "ASAAS_CARD_RECHARGE", "descricao": "Recarga de cartão Asaas"},
        {"codigo": "ASAAS_CARD_RECHARGE_REVERSAL", "descricao": "Estorno da recarga de cartão"},
        {"codigo": "ASAAS_CARD_TRANSACTION", "descricao": "Transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_CASHBACK", "descricao": "Cashback recebido com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_TRANSACTION_FEE", "descricao": "Taxa para transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_TRANSACTION_FEE_REFUND", "descricao": "Estorno de taxa para transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_TRANSACTION_PARTIAL_REFUND", "descricao": "Estorno parcial de transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_TRANSACTION_PARTIAL_REFUND_CANCELLATION", "descricao": "Cancelamento do estorno parcial de transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_TRANSACTION_REFUND", "descricao": "Estorno de transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_CARD_TRANSACTION_REFUND_CANCELLATION", "descricao": "Cancelamento do estorno de transação efetuada com o cartão Asaas"},
        {"codigo": "ASAAS_MONEY_PAYMENT_ANTICIPATION_FEE_REFUND", "descricao": "Estorno taxa de Parcelamento ASAAS Money"},
        {"codigo": "ASAAS_MONEY_PAYMENT_COMPROMISED_BALANCE", "descricao": "Bloqueio de saldo comprometido com pagamento Asaas Money"},
        {"codigo": "ASAAS_MONEY_PAYMENT_COMPROMISED_BALANCE_REFUND", "descricao": "Cancelamento do bloqueio de saldo comprometido com pagamento Asaas Money"},
        {"codigo": "ASAAS_MONEY_PAYMENT_FINANCING_FEE", "descricao": "Taxa de financiamento ASAAS Money"},
        {"codigo": "ASAAS_MONEY_PAYMENT_FINANCING_FEE_REFUND", "descricao": "Estorno taxa de financiamento ASAAS"},
        {"codigo": "PAYMENT", "descricao": "Pagamento/Recebimento padrão"},
        {"codigo": "TRANSFER", "descricao": "Transferência"},
        {"codigo": "REFUND", "descricao": "Estorno"},
    ]
    
    # Verifica quais tipos já estão mapeados
    mapeamentos_existentes = db.exec(
        select(MapeamentoCategoria).where(
            MapeamentoCategoria.integracao_id == integracao_id
        )
    ).all()
    
    tipos_mapeados = {m.categoria_externa for m in mapeamentos_existentes}
    
    # Adiciona flag de mapeado
    for tipo in tipos_asaas:
        tipo["mapeado"] = tipo["codigo"] in tipos_mapeados
        if tipo["mapeado"]:
            # Busca o mapeamento para mostrar a categoria
            mapeamento = next((m for m in mapeamentos_existentes if m.categoria_externa == tipo["codigo"]), None)
            if mapeamento:
                plano_contas = db.get(PlanoContas, mapeamento.plano_contas_id)
                tipo["categoria_mapeada"] = plano_contas.nome if plano_contas else None
    
    return tipos_asaas


@router.get("/{integracao_id}/asaas/cobrancas")
def listar_cobrancas_asaas(
    integracao_id: int,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(status_code=404, detail="Integração não encontrada")
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(status_code=400, detail="Esta integração não é do tipo Asaas")
    return buscar_cobrancas_asaas(db, integracao=integracao, status=status, limit=limit)


@router.get("/{integracao_id}/asaas/assinaturas")
def listar_assinaturas_asaas(
    integracao_id: int,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(status_code=404, detail="Integração não encontrada")
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(status_code=400, detail="Esta integração não é do tipo Asaas")
    return buscar_assinaturas_asaas(db, integracao=integracao, status=status, limit=limit)


@router.get("/{integracao_id}/asaas/contas-receber")
def listar_contas_receber_asaas(
    integracao_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(status_code=404, detail="Integração não encontrada")
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(status_code=400, detail="Esta integração não é do tipo Asaas")

    abertas = buscar_cobrancas_asaas(db, integracao=integracao, status="PENDING", limit=limit)
    atrasadas = buscar_cobrancas_asaas(db, integracao=integracao, status="OVERDUE", limit=limit)
    return {
        "abertas": abertas,
        "atrasadas": atrasadas
    }




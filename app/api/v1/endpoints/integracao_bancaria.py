"""
Endpoints para gerenciar integrações bancárias.
Permite configurar, listar, atualizar e sincronizar integrações.
"""
from datetime import date, datetime
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session
from loguru import logger
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel
from sqlalchemy import func, or_

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user, require_permission, require_any_permission, get_current_user
from app.crud import crud_integracao_bancaria
from app.core.encryption import decrypt_token
from app.schemas.integracao_bancaria import (
    IntegracaoBancariaCreate,
    IntegracaoBancariaUpdate,
    IntegracaoBancariaRead,
    MapeamentoCategoriaCreate,
    MapeamentoCategoriaRead
)
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.lancamento import Lancamento
from app.models.usuario import Usuario
from app.enums import ConsultorRole
from sqlmodel import select
from app.services.integracao_asaas import (
    buscar_cobrancas_asaas,
    buscar_assinaturas_asaas,
    buscar_saldo_asaas,
    listar_tipos_recentes_asaas,
)
from app.services.integracao_nfstock import sincronizar_nfstock, set_nfstock_schedule

router = APIRouter()
AUTHORIZED_ASAAS_RESET_EMAILS = {"cirocue12@gmail.com", "cirocaue12@gmail.com"}
AUTHORIZED_NFSTOCK_FORCE_SYNC_EMAILS = {"cirocaue12@gmail.com"}
ASAAS_TIPO_OBSERVACAO_REGEX = re.compile(r"tipo\s*:\s*([^|]+)", re.IGNORECASE)


ASAAS_TIPOS_EXTRATO_DOCUMENTACAO: List[Tuple[str, str]] = [
    ("ASAAS_CARD_RECHARGE", "Recarga de cartao Asaas"),
    ("ASAAS_CARD_RECHARGE_REVERSAL", "Estorno da recarga de cartao"),
    ("ASAAS_CARD_TRANSACTION", "Transacao efetuada com o cartao Asaas"),
    ("ASAAS_CARD_CASHBACK", "Cashback recebido com o cartao Asaas"),
    ("ASAAS_CARD_TRANSACTION_FEE", "Taxa para transacao efetuada com o cartao Asaas"),
    ("ASAAS_CARD_TRANSACTION_FEE_REFUND", "Estorno de taxa para transacao efetuada com o cartao Asaas"),
    ("ASAAS_CARD_TRANSACTION_PARTIAL_REFUND", "Estorno parcial de transacao efetuada com o cartao Asaas"),
    ("ASAAS_CARD_TRANSACTION_PARTIAL_REFUND_CANCELLATION", "Cancelamento do estorno parcial de transacao efetuada com o cartao Asaas"),
    ("ASAAS_CARD_TRANSACTION_REFUND", "Estorno de transacao efetuada com o cartao Asaas"),
    ("ASAAS_CARD_TRANSACTION_REFUND_CANCELLATION", "Cancelamento do estorno de transacao efetuada com o cartao Asaas"),
    ("ASAAS_MONEY_PAYMENT_ANTICIPATION_FEE_REFUND", "Estorno taxa de parcelamento ASAAS Money"),
    ("ASAAS_MONEY_PAYMENT_COMPROMISED_BALANCE", "Bloqueio de saldo comprometido com pagamento Asaas Money"),
    ("ASAAS_MONEY_PAYMENT_COMPROMISED_BALANCE_REFUND", "Cancelamento do bloqueio de saldo comprometido com pagamento Asaas Money"),
    ("ASAAS_MONEY_PAYMENT_FINANCING_FEE", "Taxa de financiamento ASAAS Money"),
    ("ASAAS_MONEY_PAYMENT_FINANCING_FEE_REFUND", "Estorno taxa de financiamento ASAAS Money"),
    ("ASAAS_MONEY_TRANSACTION_CASHBACK", "Cashback ASAAS Money"),
    ("ASAAS_MONEY_TRANSACTION_CASHBACK_REFUND", "Estorno de cashback ASAAS Money"),
    ("ASAAS_MONEY_TRANSACTION_CHARGEBACK", "Chargeback transacao Asaas Money"),
    ("ASAAS_MONEY_TRANSACTION_CHARGEBACK_REVERSAL", "Estorno chargeback transacao Asaas Money"),
    ("BILL_PAYMENT", "Pagamento de conta"),
    ("BILL_PAYMENT_CANCELLED", "Cancelamento do pagamento de conta"),
    ("BILL_PAYMENT_REFUNDED", "Estorno do pagamento de conta"),
    ("BILL_PAYMENT_FEE", "Taxa de pagamento de conta"),
    ("BILL_PAYMENT_FEE_CANCELLED", "Cancelamento da taxa de pagamento de conta"),
    ("CHARGEBACK", "Bloqueio de saldo devido ao chargeback de cobranca"),
    ("CHARGEBACK_REVERSAL", "Cancelamento do bloqueio de saldo devido ao chargeback"),
    ("CHARGED_FEE_REFUND", "Estorno da taxa para negativacao da cobranca ou Pix"),
    ("CONTRACTUAL_EFFECT_SETTLEMENT", "Valor em recebiveis reservado"),
    ("CONTRACTUAL_EFFECT_SETTLEMENT_REVERSAL", "Estorno do valor em recebiveis reservado"),
    ("CREDIT", "Credito"),
    ("CREDIT_BUREAU_REPORT", "Taxa de consulta Serasa"),
    ("CUSTOMER_COMMISSION_SETTLEMENT_CREDIT", "Credito de liquidacao de comissao de parceiros"),
    ("CUSTOMER_COMMISSION_SETTLEMENT_DEBIT", "Debito de liquidacao de comissao de parceiros"),
    ("DEBIT", "Debito"),
    ("DEBIT_REVERSAL", "Estorno de debito"),
    ("DEBT_RECOVERY_NEGOTIATION_FINANCIAL_CHARGES", "Encargos sobre renegociacao"),
    ("FREE_PAYMENT_USE", "Estorno por campanha promocional na tarifa"),
    ("INTERNAL_TRANSFER_CREDIT", "Transferencia da conta Asaas"),
    ("INTERNAL_TRANSFER_DEBIT", "Transferencia para a conta Asaas"),
    ("INTERNAL_TRANSFER_REVERSAL", "Estorno de transferencia para a conta Asaas"),
    ("INVOICE_FEE", "Taxa de emissao da nota fiscal de servico"),
    ("PARTIAL_PAYMENT", "Cobranca parcialmente recebida"),
    ("PAYMENT_DUNNING_CANCELLATION_FEE", "Taxa para cancelamento de negativacao de cobranca"),
    ("PAYMENT_DUNNING_RECEIVED_FEE", "Taxa para negativacao de cobranca"),
    ("PAYMENT_DUNNING_RECEIVED_IN_CASH_FEE", "Taxa para negativacao em dinheiro de cobranca"),
    ("PAYMENT_DUNNING_REQUEST_FEE", "Taxa para negativacao de cobranca"),
    ("PAYMENT_FEE", "Taxa de boleto, cartao ou Pix"),
    ("PAYMENT_FEE_REVERSAL", "Estorno da taxa de boleto, cartao ou Pix"),
    ("PAYMENT_MESSAGING_NOTIFICATION_FEE", "Taxa de mensageria de fatura"),
    ("PAYMENT_RECEIVED", "Cobranca recebida"),
    ("PAYMENT_CUSTODY_BLOCK", "Bloqueio de saldo por custodia"),
    ("PAYMENT_CUSTODY_BLOCK_REVERSAL", "Desbloqueio de saldo por custodia"),
    ("PAYMENT_REFUND_CANCELLED", "Cancelamento do estorno de fatura"),
    ("PAYMENT_REVERSAL", "Estorno de fatura"),
    ("PAYMENT_SMS_NOTIFICATION_FEE", "Taxa de notificacao por SMS de cobranca"),
    ("PAYMENT_INSTANT_TEXT_MESSAGE_FEE", "Taxa de notificacao por mensagem instantanea de cobranca"),
    ("PHONE_CALL_NOTIFICATION_FEE", "Taxa de notificacao por voz"),
    ("PIX_TRANSACTION_CREDIT", "Transferencia via Pix recebida"),
    ("PIX_TRANSACTION_CREDIT_FEE", "Taxa de transferencia Pix recebida"),
    ("PIX_TRANSACTION_CREDIT_REFUND", "Estorno de recebimento via Pix"),
    ("PIX_TRANSACTION_CREDIT_REFUND_CANCELLATION", "Cancelamento de estorno de recebimento via Pix"),
    ("PIX_TRANSACTION_DEBIT", "Transacao via Pix"),
    ("PIX_TRANSACTION_DEBIT_FEE", "Taxa para Pix"),
    ("PIX_TRANSACTION_DEBIT_REFUND", "Estorno de transacao via Pix"),
    ("POSTAL_SERVICE_FEE", "Taxa de envio de boletos via Correios"),
    ("PRODUCT_INVOICE_FEE", "Taxa de emissao da nota fiscal de produto emitida via Base ERP"),
    ("CONSUMER_INVOICE_FEE", "Taxa de emissao da nota fiscal de consumidor emitida via Base ERP"),
    ("PROMOTIONAL_CODE_CREDIT", "Desconto na taxa"),
    ("PROMOTIONAL_CODE_DEBIT", "Estorno do desconto na taxa"),
    ("RECEIVABLE_ANTICIPATION_GROSS_CREDIT", "Antecipacao de parcelamento ou cobranca"),
    ("RECEIVABLE_ANTICIPATION_DEBIT", "Baixa da parcela ou antecipacao"),
    ("RECEIVABLE_ANTICIPATION_FEE", "Taxa de antecipacao de parcelamento ou cobranca"),
    ("RECEIVABLE_ANTICIPATION_PARTNER_SETTLEMENT", "Baixa da parcela ou antecipacao"),
    ("REFUND_REQUEST_CANCELLED", "Cancelamento do estorno de fatura"),
    ("REFUND_REQUEST_FEE", "Taxa de realizacao de estorno de fatura"),
    ("REFUND_REQUEST_FEE_REVERSAL", "Cancelamento da taxa de realizacao de estorno de fatura"),
    ("REVERSAL", "Estorno"),
    ("TRANSFER", "Transferencia para conta bancaria"),
    ("TRANSFER_FEE", "Taxa de transferencia para conta bancaria"),
    ("TRANSFER_REVERSAL", "Estorno de transferencia para conta bancaria"),
    ("MOBILE_PHONE_RECHARGE", "Recarga de celular"),
    ("REFUND_MOBILE_PHONE_RECHARGE", "Estorno de recarga de celular"),
    ("CANCEL_MOBILE_PHONE_RECHARGE", "Cancelamento de recarga de celular"),
    ("INSTANT_TEXT_MESSAGE_FEE", "Taxa de notificacao por WhatsApp"),
    ("ASAAS_CARD_BALANCE_REFUND", "Estorno de cartao Asaas"),
    ("ASAAS_MONEY_PAYMENT_ANTICIPATION_FEE", "Taxa de parcelamento ASAAS Money"),
    ("BACEN_JUDICIAL_LOCK", "Bloqueio judicial"),
    ("BACEN_JUDICIAL_UNLOCK", "Desbloqueio judicial"),
    ("BACEN_JUDICIAL_TRANSFER", "Transferencia judicial"),
    ("ASAAS_DEBIT_CARD_REQUEST_FEE", "Taxa de adesao do cartao Elo debito"),
    ("ASAAS_PREPAID_CARD_REQUEST_FEE", "Taxa de adesao do cartao Elo pre-pago"),
    ("EXTERNAL_SETTLEMENT_CONTRACTUAL_EFFECT_BATCH_CREDIT", "Credito de valores para liquidacao de efeitos de contrato"),
    ("EXTERNAL_SETTLEMENT_CONTRACTUAL_EFFECT_BATCH_REVERSAL", "Estorno de valores referentes a liquidacao de efeitos de contrato"),
    ("ASAAS_CARD_BILL_PAYMENT", "Pagamento de fatura do cartao Asaas"),
    ("ASAAS_CARD_BILL_PAYMENT_REFUND", "Estorno de pagamento de fatura do cartao Asaas"),
    ("CHILD_ACCOUNT_KNOWN_YOUR_CUSTOMER_BATCH_FEE", "Taxa de criacao de contas filhas"),
    ("CONTRACTED_CUSTOMER_PLAN_FEE", "Taxa da mensalidade do plano Asaas"),
    ("ACCOUNT_INACTIVITY_FEE", "Taxa de conta inativa"),
]

ASAAS_TIPOS_COMPATIBILIDADE: List[Tuple[str, str]] = [
    ("PAYMENT", "Compatibilidade com pagamentos sem type"),
    ("REFUND", "Compatibilidade com estornos sem type"),
    ("RECEIVED", "Status de cobranca recebida"),
    ("CONFIRMED", "Status de cobranca confirmada"),
    ("DONE", "Status de operacao concluida"),
    ("RECEIVED_IN_CASH", "Status de cobranca recebida em dinheiro"),
    ("PENDING", "Status de cobranca pendente"),
    ("AWAITING_PAYMENT", "Status aguardando pagamento"),
    ("OVERDUE", "Status de cobranca vencida"),
    ("BOLETO", "Tipo de cobranca boleto"),
    ("CREDIT_CARD", "Tipo de cobranca cartao de credito"),
    ("PIX", "Tipo de cobranca Pix"),
]


def _normalizar_codigo_externo(valor: Optional[str]) -> str:
    return str(valor or "").strip().upper()


def _montar_catalogo_tipos_asaas() -> List[Dict[str, str]]:
    catalogo: List[Dict[str, str]] = []
    codigos_vistos = set()

    for codigo, descricao in [*ASAAS_TIPOS_EXTRATO_DOCUMENTACAO, *ASAAS_TIPOS_COMPATIBILIDADE]:
        codigo_normalizado = _normalizar_codigo_externo(codigo)
        if not codigo_normalizado or codigo_normalizado in codigos_vistos:
            continue
        codigos_vistos.add(codigo_normalizado)
        catalogo.append({
            "codigo": codigo_normalizado,
            "descricao": descricao,
        })

    return catalogo


def _inferir_fluxo_asaas(codigo_externo: Optional[str]) -> Optional[str]:
    """
    Retorna fluxo sugerido para validacao de categoria:
      - "R" para receita
      - "D" para despesa
      - None quando ambiguo
    """
    codigo = _normalizar_codigo_externo(codigo_externo)
    if not codigo:
        return None

    # Estornos/cancelamentos podem inverter sinal conforme contexto, entao nao bloqueamos.
    if any(token in codigo for token in ("REFUND", "REVERSAL", "CANCELLED", "CANCELLATION")):
        return None

    codigos_receita = {
        "CREDIT",
        "PAYMENT_RECEIVED",
        "PARTIAL_PAYMENT",
        "INTERNAL_TRANSFER_CREDIT",
        "PIX_TRANSACTION_CREDIT",
        "RECEIVABLE_ANTICIPATION_GROSS_CREDIT",
        "CUSTOMER_COMMISSION_SETTLEMENT_CREDIT",
        "PROMOTIONAL_CODE_CREDIT",
        "EXTERNAL_SETTLEMENT_CONTRACTUAL_EFFECT_BATCH_CREDIT",
    }
    codigos_despesa = {
        "DEBIT",
        "BILL_PAYMENT",
        "TRANSFER",
        "PIX_TRANSACTION_DEBIT",
        "RECEIVABLE_ANTICIPATION_DEBIT",
        "CONTRACTUAL_EFFECT_SETTLEMENT",
        "CHARGEBACK",
        "PAYMENT_CUSTODY_BLOCK",
        "BACEN_JUDICIAL_LOCK",
        "ASAAS_CARD_TRANSACTION",
        "ASAAS_CARD_RECHARGE",
        "ASAAS_CARD_BILL_PAYMENT",
        "MOBILE_PHONE_RECHARGE",
    }

    if codigo in codigos_receita or codigo.endswith("_CREDIT") or "CASHBACK" in codigo:
        return "R"

    if codigo in codigos_despesa or codigo.endswith("_DEBIT") or "_FEE" in codigo:
        return "D"

    return None


class AsaasResetRequest(BaseModel):
    data_inicio_sincronizacao: Optional[date] = None


class NfstockConfigPayload(BaseModel):
    nome: str
    username: str
    password: str
    centro_custo_id: int
    select_company: bool = False
    company_name: Optional[str] = None
    ativo: bool = True


class NfstockSyncByLoginPayload(BaseModel):
    username: str


def _can_manage_asaas_reset(current_user: Usuario) -> bool:
    email = (getattr(current_user, "email", "") or "").strip().lower()
    is_super = bool(
        current_user.is_consultor
        and str(current_user.consultor_role or "").upper() == ConsultorRole.SUPER_CONSULTOR.value
    )
    return is_super or email in AUTHORIZED_ASAAS_RESET_EMAILS


def _can_force_nfstock_sync(current_user: Usuario) -> bool:
    email = (getattr(current_user, "email", "") or "").strip().lower()
    return email in AUTHORIZED_NFSTOCK_FORCE_SYNC_EMAILS


def _serialize_integracao(integracao: IntegracaoBancaria) -> dict:
    payload = integracao.model_dump()
    token_configurado = False
    token_criptografado = str(integracao.token_criptografado or "").strip()

    if token_criptografado:
        try:
            token_plano = decrypt_token(token_criptografado)
            token_configurado = bool(str(token_plano or "").strip())
        except Exception:
            # Mantém compatibilidade com registros legados caso não seja possível decriptar.
            token_configurado = True

    payload["token_configurado"] = token_configurado

    if str(integracao.tipo or "").upper() == "NFSTOCK":
        try:
            from app.core.encryption import decrypt_dict
            cfg_raw = str(integracao.configuracao_adicional or "").strip()
            cfg = decrypt_dict(cfg_raw) if cfg_raw else {}
            if not isinstance(cfg, dict):
                cfg = {}
        except Exception:
            cfg = {}
        payload["nfstock_username"] = str(cfg.get("username") or "").strip() or None
        payload["nfstock_select_company"] = bool(cfg.get("select_company", False))
        payload["nfstock_company_name"] = str(cfg.get("company_name") or "").strip() or None

    return payload


def _extrair_tipo_asaas_da_observacao(observacao: Optional[str]) -> Optional[str]:
    texto = str(observacao or "").strip()
    if not texto:
        return None
    match = ASAAS_TIPO_OBSERVACAO_REGEX.search(texto)
    if not match:
        return None
    tipo = _normalizar_codigo_externo(match.group(1))
    if not tipo or tipo in {"NAO_INFORMADO", "NONE", "N/A", "NULL"}:
        return None
    return tipo


def _listar_tipos_recentes_asaas_local(
    *,
    db: Session,
    integracao: IntegracaoBancaria,
    empresa_id: int,
    limite: int = 100,
) -> List[str]:
    limite_efetivo = max(1, min(int(limite or 100), 100))

    statement = select(Lancamento).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        or_(
            Lancamento.origem == "ASAAS",
            Lancamento.import_hash.like("ASAAS:%"),
            Lancamento.observacao.ilike("%Asaas ID:%"),
        ),
    )

    if integracao.conta_id:
        statement = statement.where(Lancamento.conta_id == integracao.conta_id)

    lancamentos = db.exec(
        statement.order_by(
            func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento, Lancamento.data_competencia).desc(),
            Lancamento.id.desc(),
        ).limit(limite_efetivo)
    ).all()

    codigos: List[str] = []
    for lancamento in lancamentos:
        codigo = _extrair_tipo_asaas_da_observacao(lancamento.observacao)
        if not codigo:
            continue
        if codigo not in codigos:
            codigos.append(codigo)

    return codigos


def _descricao_padrao_tipo_asaas(codigo: str) -> str:
    codigo_normalizado = _normalizar_codigo_externo(codigo)
    if not codigo_normalizado:
        return "Tipo Asaas"
    return "Tipo detectado no Asaas: " + codigo_normalizado.replace("_", " ").title()


def _propagar_mapeamento_asaas_para_lancamentos(
    *,
    db: Session,
    integracao: IntegracaoBancaria,
    empresa_id: int,
    categoria_externa: str,
    plano_contas: PlanoContas,
) -> int:
    codigo_normalizado = _normalizar_codigo_externo(categoria_externa)
    if not codigo_normalizado:
        return 0

    filtros_tipo = [func.upper(Lancamento.observacao).like(f"%TIPO: {codigo_normalizado}%")]
    if codigo_normalizado == "PAYMENT":
        filtros_tipo.append(func.upper(Lancamento.observacao).like("%TIPO: NAO_INFORMADO%"))
        filtros_tipo.append(func.upper(Lancamento.observacao).like("%TIPO: NONE%"))

    statement = select(Lancamento).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        Lancamento.plano_contas_id != plano_contas.id,
        or_(
            Lancamento.origem == "ASAAS",
            Lancamento.import_hash.like("ASAAS:%"),
            Lancamento.observacao.ilike("%Asaas ID:%"),
        ),
        or_(*filtros_tipo),
    )

    if integracao.conta_id:
        statement = statement.where(Lancamento.conta_id == integracao.conta_id)

    tipo_plano = str(plano_contas.tipo or "").strip().upper()
    if tipo_plano.startswith("R"):
        statement = statement.where(func.upper(Lancamento.tipo) == "RECEITA")
    elif tipo_plano.startswith("D"):
        statement = statement.where(func.upper(Lancamento.tipo) == "DESPESA")

    lancamentos = db.exec(statement).all()
    atualizados = 0
    for lancamento in lancamentos:
        lancamento.plano_contas_id = plano_contas.id
        db.add(lancamento)
        atualizados += 1

    return atualizados


@router.get(
    "/",
    response_model=List[IntegracaoBancariaRead],
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view", "page:contas:view"]))],
)
def listar_integracoes(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Lista todas as integrações bancárias da empresa.
    """
    logger.info(f"Listando integrações bancárias da empresa ID: {empresa_id}")
    integracoes = crud_integracao_bancaria.get_by_empresa(db=db, empresa_id=empresa_id)
    return [_serialize_integracao(integracao) for integracao in integracoes]


@router.get(
    "/{integracao_id}",
    response_model=IntegracaoBancariaRead,
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view", "page:contas:view"]))],
)
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
    return _serialize_integracao(integracao)


@router.post(
    "/",
    response_model=IntegracaoBancariaRead,
    status_code=201,
    dependencies=[Depends(require_permission("integracoes:create"))],
)
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
    tipos_validos = ["ASAAS", "ITAU", "NUBANK", "INTER", "SANTANDER", "NFSTOCK"]
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

    if integracao_in.tipo.upper() == "NFSTOCK" and integracao_in.ambiente.upper() != "PRODUCAO":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integrações NFStock só são permitidas em PRODUCAO."
        )

    conta_id = integracao_in.conta_id
    centro_custo_id = integracao_in.centro_custo_id
    conta_vinculada: Optional[Conta] = None

    if integracao_in.tipo.upper() == "ASAAS" and not conta_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integração Asaas exige conta bancária vinculada."
        )

    if conta_id:
        conta_vinculada = db.exec(
            select(Conta).where(Conta.id == conta_id, Conta.empresa_id == empresa_id)
        ).first()
        if not conta_vinculada:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conta bancária para vinculação não encontrada"
            )

        if centro_custo_id is None and conta_vinculada.centro_custo_id:
            centro_custo_id = conta_vinculada.centro_custo_id

        duplicada = db.exec(
            select(IntegracaoBancaria).where(
                IntegracaoBancaria.empresa_id == empresa_id,
                IntegracaoBancaria.tipo == integracao_in.tipo.upper(),
                IntegracaoBancaria.conta_id == conta_id,
                IntegracaoBancaria.is_deleted == False,
            )
        ).first()
        if duplicada:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta conta já está vinculada a uma integração deste tipo"
            )

    if centro_custo_id is not None:
        cc_val = db.exec(
            select(CentroCusto).where(
                CentroCusto.id == centro_custo_id,
                CentroCusto.empresa_id == empresa_id,
                CentroCusto.is_deleted == False,
            )
        ).first()
        if not cc_val:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Centro de custo não encontrado"
            )

    if integracao_in.categoria_padrao_id is not None:
        cat_val = db.exec(
            select(PlanoContas).where(
                PlanoContas.id == integracao_in.categoria_padrao_id,
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.is_deleted == False,
            )
        ).first()
        if not cat_val:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Categoria padrão financeira não encontrada ou não pertence a esta empresa."
            )

    integracao_payload = integracao_in.model_dump()
    integracao_payload["centro_custo_id"] = centro_custo_id
    if integracao_in.tipo.upper() == "ASAAS" and conta_vinculada:
        nome_padrao = str(conta_vinculada.banco or conta_vinculada.nome or "Asaas").strip() or "Asaas"
        integracao_payload["nome"] = nome_padrao
        if str(conta_vinculada.tipo_integracao or "").upper() != "ASAAS":
            conta_vinculada.tipo_integracao = "ASAAS"
            db.add(conta_vinculada)
    integracao_obj = IntegracaoBancariaCreate(**integracao_payload)

    integracao = crud_integracao_bancaria.create(
        db=db,
        obj_in=integracao_obj,
        empresa_id=empresa_id
    )
    
    logger.success(f"Integração bancária criada com sucesso! ID: {integracao.id}")
    return _serialize_integracao(integracao)


@router.patch(
    "/{integracao_id}",
    response_model=IntegracaoBancariaRead,
    dependencies=[Depends(require_permission("integracoes:update"))],
)
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

    update_payload = integracao_in.model_dump(exclude_unset=True)
    if "token" in update_payload and not str(update_payload.get("token") or "").strip():
        update_payload.pop("token")

    if integracao.tipo.upper() == "ASAAS" and "conta_id" in update_payload:
        conta_id_update = update_payload.get("conta_id")
        if conta_id_update is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Integração Asaas deve permanecer vinculada a uma conta."
            )
        if integracao.conta_id and int(conta_id_update) != int(integracao.conta_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Para trocar a conta Asaas, configure uma nova integração pela conta desejada."
            )

    if "conta_id" in update_payload:
        conta_id = update_payload.get("conta_id")
        if conta_id is not None:
            conta = db.exec(
                select(Conta).where(Conta.id == conta_id, Conta.empresa_id == empresa_id)
            ).first()
            if not conta:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conta bancária para vinculação não encontrada"
                )

            duplicada = db.exec(
                select(IntegracaoBancaria).where(
                    IntegracaoBancaria.empresa_id == empresa_id,
                    IntegracaoBancaria.tipo == integracao.tipo,
                    IntegracaoBancaria.conta_id == conta_id,
                    IntegracaoBancaria.id != integracao.id,
                    IntegracaoBancaria.is_deleted == False,
                )
            ).first()
            if duplicada:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Esta conta já está vinculada a outra integração deste tipo"
                )

            if "centro_custo_id" not in update_payload and conta.centro_custo_id:
                update_payload["centro_custo_id"] = conta.centro_custo_id

    if "centro_custo_id" in update_payload and update_payload["centro_custo_id"] is not None:
        cc_val = db.exec(
            select(CentroCusto).where(
                CentroCusto.id == update_payload["centro_custo_id"],
                CentroCusto.empresa_id == empresa_id,
                CentroCusto.is_deleted == False,
            )
        ).first()
        if not cc_val:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Centro de custo não encontrado"
            )

    if "categoria_padrao_id" in update_payload and update_payload["categoria_padrao_id"] is not None:
        cat_val = db.exec(
            select(PlanoContas).where(
                PlanoContas.id == update_payload["categoria_padrao_id"],
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.is_deleted == False,
            )
        ).first()
        if not cat_val:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Categoria padrão financeira não encontrada ou não pertence a esta empresa."
            )

    integracao_update = IntegracaoBancariaUpdate(**update_payload)

    integracao = crud_integracao_bancaria.update(
        db=db,
        db_obj=integracao,
        obj_in=integracao_update
    )

    return _serialize_integracao(integracao)


@router.delete(
    "/{integracao_id}",
    status_code=204,
    dependencies=[Depends(require_permission("integracoes:delete"))],
)
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


@router.post(
    "/{integracao_id}/sincronizar",
    dependencies=[Depends(require_permission("integracoes:sync"))],
)
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
    elif integracao.tipo.upper() == "NFSTOCK":
        resultado = sincronizar_nfstock(
            db=db,
            integracao=integracao,
            dry_run=False,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Sincronização para tipo {integracao.tipo} ainda não implementada"
        )

    if isinstance(resultado, dict):
        resultado.setdefault(
            "data_inicio_configurada",
            integracao.data_inicio_sincronizacao.isoformat() if integracao.data_inicio_sincronizacao else None,
        )
    
    return resultado


@router.post(
    "/nfstock/configurar",
    dependencies=[Depends(require_permission("integracoes:create"))],
)
def configurar_integracao_nfstock(
    payload: NfstockConfigPayload,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    from app.core.encryption import encrypt_dict

    username = str(payload.username or "").strip()
    password = str(payload.password or "").strip()
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Usuário e senha do NFStock são obrigatórios")

    centro_custo = db.exec(
        select(Conta.id).where(
            Conta.empresa_id == empresa_id,
            Conta.is_deleted == False,
            Conta.centro_custo_id == payload.centro_custo_id,
        )
    ).first()
    if payload.centro_custo_id and centro_custo is None:
        # apenas valida que existe algum vínculo financeiro para o centro (modelo atual)
        pass

    existente = db.exec(
        select(IntegracaoBancaria).where(
            IntegracaoBancaria.empresa_id == empresa_id,
            IntegracaoBancaria.tipo == "NFSTOCK",
            IntegracaoBancaria.centro_custo_id == payload.centro_custo_id,
        )
    ).first()

    cfg = {
        "username": username,
        "select_company": bool(payload.select_company),
        "company_name": str(payload.company_name or "").strip(),
        "login_url": "https://nfstock.alterdata.com.br/",
        "target_url": "https://nfstock.alterdata.com.br/Nfe/Recebidas",
    }

    if existente:
        existente.nome = str(payload.nome or existente.nome)
        existente.token_criptografado = crud_integracao_bancaria.encrypt_token(password) if hasattr(crud_integracao_bancaria, 'encrypt_token') else existente.token_criptografado
        from app.core.encryption import encrypt_token
        existente.token_criptografado = encrypt_token(password)
        existente.configuracao_adicional = encrypt_dict(cfg)
        existente.ativo = bool(payload.ativo)
        existente.sincronizar_automaticamente = True
        set_nfstock_schedule(existente)
        db.add(existente)
        db.commit()
        db.refresh(existente)
        return _serialize_integracao(existente)

    from app.schemas.integracao_bancaria import IntegracaoBancariaCreate
    create_payload = IntegracaoBancariaCreate(
        nome=str(payload.nome or "NFStock").strip() or "NFStock",
        tipo="NFSTOCK",
        ambiente="PRODUCAO",
        token=password,
        configuracao_adicional=cfg,
        ativo=bool(payload.ativo),
        sincronizar_automaticamente=True,
        intervalo_sincronizacao_minutos=24 * 60,
        conta_id=None,
        centro_custo_id=payload.centro_custo_id,
    )

    integracao = crud_integracao_bancaria.create(db=db, obj_in=create_payload, empresa_id=empresa_id)
    set_nfstock_schedule(integracao)
    db.add(integracao)
    db.commit()
    db.refresh(integracao)
    return _serialize_integracao(integracao)


@router.post(
    "/nfstock/sincronizar-por-login",
    dependencies=[Depends(require_permission("integracoes:sync"))],
)
def sincronizar_nfstock_por_login(
    payload: NfstockSyncByLoginPayload,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_user),
):
    if not _can_force_nfstock_sync(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ação restrita para este usuário.",
        )

    username = str(payload.username or "").strip()
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informe o login NFStock.",
        )

    username_normalizado = username.lower()
    integracoes_nfstock = db.exec(
        select(IntegracaoBancaria).where(
            IntegracaoBancaria.empresa_id == empresa_id,
            IntegracaoBancaria.tipo == "NFSTOCK",
            IntegracaoBancaria.ativo == True,
        )
    ).all()

    from app.core.encryption import decrypt_dict

    integracao_alvo: Optional[IntegracaoBancaria] = None
    for integracao in integracoes_nfstock:
        try:
            cfg_raw = str(integracao.configuracao_adicional or "").strip()
            cfg = decrypt_dict(cfg_raw) if cfg_raw else {}
            if not isinstance(cfg, dict):
                cfg = {}
        except Exception:
            cfg = {}

        username_cfg = str(cfg.get("username") or "").strip().lower()
        if username_cfg == username_normalizado:
            integracao_alvo = integracao
            break

    if not integracao_alvo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integração NFStock não encontrada para este login.",
        )

    resultado = sincronizar_nfstock(
        db=db,
        integracao=integracao_alvo,
        dry_run=False,
    )

    if isinstance(resultado, dict):
        resultado.setdefault("forcado_por_login", True)
        resultado.setdefault("login_nfstock", username)

    return resultado


@router.post(
    "/{integracao_id}/asaas/reset",
    dependencies=[Depends(require_permission("integracoes:sync"))],
)
def resetar_lancamentos_asaas(
    integracao_id: int,
    payload: AsaasResetRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_user),
):
    if not _can_manage_asaas_reset(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ação restrita para este usuário.",
        )

    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integração não encontrada")
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta integração não é do tipo Asaas")

    agora = datetime.utcnow()
    lancamentos_asaas = db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            or_(
                Lancamento.origem == "ASAAS",
                Lancamento.import_hash.like("ASAAS:%"),
                Lancamento.observacao.ilike("%Asaas ID:%"),
            ),
        )
    ).all()

    total_resetado = 0
    user_id = int(getattr(current_user, "id", 0) or 0)
    for lancamento in lancamentos_asaas:
        lancamento.is_deleted = True
        lancamento.deleted_at = agora
        lancamento.deleted_by_id = user_id or None
        db.add(lancamento)
        total_resetado += 1

    integracao.data_inicio_sincronizacao = payload.data_inicio_sincronizacao
    integracao.ultima_sincronizacao = None
    if integracao.sincronizar_automaticamente:
        integracao.proxima_sincronizacao = agora
    db.add(integracao)
    db.commit()

    logger.warning(
        "Reset Asaas solicitado por {} na empresa {}: {} lançamentos marcados como removidos. data_inicio_sincronizacao={}",
        current_user.email,
        empresa_id,
        total_resetado,
        payload.data_inicio_sincronizacao,
    )

    return {
        "sucesso": True,
        "lancamentos_resetados": total_resetado,
        "data_inicio_sincronizacao": payload.data_inicio_sincronizacao.isoformat() if payload.data_inicio_sincronizacao else None,
        "mensagem": "Lançamentos de origem Asaas resetados com sucesso.",
    }


@router.get(
    "/{integracao_id}/mapeamentos",
    response_model=List[MapeamentoCategoriaRead],
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"]))],
)
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
            MapeamentoCategoria.integracao_id == integracao_id,
            MapeamentoCategoria.is_deleted == False,
        )
    ).all()
    
    resultado = []
    for mapeamento in mapeamentos:
        plano_contas = db.get(PlanoContas, mapeamento.plano_contas_id)
        categoria_externa_normalizada = str(mapeamento.categoria_externa or "").strip().upper()
        resultado.append({
            "id": mapeamento.id,  # Adiciona ID para poder deletar
            "categoria_externa": categoria_externa_normalizada,
            "plano_contas_id": mapeamento.plano_contas_id,
            "plano_contas_nome": plano_contas.nome if plano_contas else None
        })
    
    return resultado


@router.post(
    "/{integracao_id}/mapeamentos",
    response_model=MapeamentoCategoriaRead,
    status_code=201,
    dependencies=[Depends(require_permission("integracoes:update"))],
)
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
    if not plano_contas or plano_contas.empresa_id != empresa_id or plano_contas.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria não encontrada"
        )
    
    categoria_externa = str(mapeamento_in.categoria_externa or "").strip().upper()
    if not categoria_externa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Categoria externa invalida"
        )

    if integracao.tipo.upper() == "ASAAS":
        fluxo_sugerido = _inferir_fluxo_asaas(categoria_externa)
        tipo_plano = str(plano_contas.tipo or "").strip().upper()
        if fluxo_sugerido and not tipo_plano.startswith(fluxo_sugerido):
            natureza = "receita" if fluxo_sugerido == "R" else "despesa"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Categoria selecionada incompatível com o tipo Asaas ({natureza}).",
            )

    # Verifica se mapeamento já existe
    mapeamento_existente = db.exec(
        select(MapeamentoCategoria).where(
            MapeamentoCategoria.integracao_id == integracao_id,
            func.upper(MapeamentoCategoria.categoria_externa) == categoria_externa,
            MapeamentoCategoria.is_deleted == False,
        )
    ).first()
    
    if mapeamento_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mapeamento já existe para esta categoria externa"
        )
    
    # Cria mapeamento
    mapeamento = MapeamentoCategoria(
        categoria_externa=categoria_externa,
        plano_contas_id=mapeamento_in.plano_contas_id,
        integracao_id=integracao_id
    )
    db.add(mapeamento)
    db.flush()

    lancamentos_atualizados = 0
    if integracao.tipo.upper() == "ASAAS":
        lancamentos_atualizados = _propagar_mapeamento_asaas_para_lancamentos(
            db=db,
            integracao=integracao,
            empresa_id=empresa_id,
            categoria_externa=categoria_externa,
            plano_contas=plano_contas,
        )

    db.commit()
    db.refresh(mapeamento)

    if lancamentos_atualizados > 0:
        logger.info(
            "Mapeamento Asaas aplicado em lote: integracao={} categoria_externa={} plano_contas_id={} lancamentos_atualizados={}",
            integracao_id,
            categoria_externa,
            plano_contas.id,
            lancamentos_atualizados,
        )
    
    return {
        "categoria_externa": categoria_externa,
        "plano_contas_id": mapeamento.plano_contas_id,
        "plano_contas_nome": plano_contas.nome
    }


@router.delete(
    "/{integracao_id}/mapeamentos/{mapeamento_id}",
    status_code=204,
    dependencies=[Depends(require_permission("integracoes:update"))],
)
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
    if not mapeamento or mapeamento.integracao_id != integracao_id or mapeamento.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapeamento não encontrado"
        )
    
    mapeamento.is_deleted = True
    mapeamento.deleted_at = datetime.utcnow()
    db.add(mapeamento)
    db.commit()
    return None


@router.get(
    "/{integracao_id}/tipos-asaas",
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"]))],
)
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
    
    catalogo_padrao = _montar_catalogo_tipos_asaas()
    descricao_por_codigo = {
        _normalizar_codigo_externo(item.get("codigo")): str(item.get("descricao") or "").strip()
        for item in catalogo_padrao
        if _normalizar_codigo_externo(item.get("codigo"))
    }

    mapeamentos_existentes = db.exec(
        select(MapeamentoCategoria).where(
            MapeamentoCategoria.integracao_id == integracao_id
        )
    ).all()

    mapeamentos_por_codigo = {}
    for mapeamento in mapeamentos_existentes:
        codigo = _normalizar_codigo_externo(mapeamento.categoria_externa)
        if codigo:
            mapeamentos_por_codigo[codigo] = mapeamento

    codigos_detectados: List[str] = _listar_tipos_recentes_asaas_local(
        db=db,
        integracao=integracao,
        empresa_id=empresa_id,
        limite=100,
    )

    if not codigos_detectados:
        try:
            codigos_detectados = listar_tipos_recentes_asaas(db=db, integracao=integracao, limit=100)
        except Exception as exc:
            logger.warning(
                "Nao foi possivel detectar tipos recentes do Asaas para integracao {}: {}",
                integracao_id,
                exc,
            )

    tipos_asaas: List[Dict[str, str]] = []
    codigos_adicionados = set()

    for codigo in codigos_detectados:
        codigo_normalizado = _normalizar_codigo_externo(codigo)
        if not codigo_normalizado or codigo_normalizado in codigos_adicionados:
            continue
        tipos_asaas.append(
            {
                "codigo": codigo_normalizado,
                "descricao": descricao_por_codigo.get(codigo_normalizado) or _descricao_padrao_tipo_asaas(codigo_normalizado),
            }
        )
        codigos_adicionados.add(codigo_normalizado)

    for codigo in sorted(mapeamentos_por_codigo.keys()):
        if codigo in codigos_adicionados:
            continue
        tipos_asaas.append(
            {
                "codigo": codigo,
                "descricao": descricao_por_codigo.get(codigo) or "Tipo customizado mapeado anteriormente",
            }
        )
        codigos_adicionados.add(codigo)

    for tipo in tipos_asaas:
        codigo = _normalizar_codigo_externo(tipo.get("codigo"))
        fluxo_sugerido = _inferir_fluxo_asaas(codigo)
        if fluxo_sugerido == "R":
            tipo["natureza_sugerida"] = "RECEITA"
        elif fluxo_sugerido == "D":
            tipo["natureza_sugerida"] = "DESPESA"
        else:
            tipo["natureza_sugerida"] = "AMBOS"

        mapeamento = mapeamentos_por_codigo.get(codigo)
        tipo["mapeado"] = bool(mapeamento)
        if not mapeamento:
            continue
        plano_contas = db.get(PlanoContas, mapeamento.plano_contas_id)
        tipo["categoria_mapeada"] = plano_contas.nome if plano_contas else None

    return tipos_asaas


@router.get(
    "/{integracao_id}/asaas/cobrancas",
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"]))],
)
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


@router.get(
    "/{integracao_id}/asaas/assinaturas",
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"]))],
)
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


@router.get(
    "/{integracao_id}/asaas/contas-receber",
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"]))],
)
def listar_contas_receber_asaas(
    integracao_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(status_code=404, detail="Integração não encontrada")
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(status_code=400, detail="Esta integração não é do tipo Asaas")

    # Busca as cobranças abertas e atrasadas em paralelo
    from concurrent.futures import ThreadPoolExecutor

    def fetch_charges_by_status(status: str):
        try:
            return buscar_cobrancas_asaas(db, integracao=integracao, status=status, limit=limit)
        except Exception as e:
            logger.error(f"Erro ao buscar cobrancas status={status} para integracao {integracao_id}: {e}")
            return []

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {
            "abertas": executor.submit(fetch_charges_by_status, "PENDING"),
            "atrasadas": executor.submit(fetch_charges_by_status, "OVERDUE"),
        }
        abertas = futures["abertas"].result()
        atrasadas = futures["atrasadas"].result()
        recebidas = []

    # Resolve os nomes dos clientes das faturas abertas e atrasadas em paralelo
    from app.services.integracao_asaas import _fetch_asaas_customer_name, get_token_decrypted
    
    access_token = None
    try:
        access_token = get_token_decrypted(db, integracao=integracao)
    except Exception:
        pass

    customer_name_cache = {}
    unique_customer_ids = {cobranca.get("customer") for cobranca in abertas + atrasadas if cobranca.get("customer")}

    # Busca os detalhes dos clientes em paralelo usando um ThreadPoolExecutor
    def fetch_customer_worker(cust_id: str):
        try:
            name = _fetch_asaas_customer_name(
                integracao=integracao,
                access_token=access_token,
                customer_id=cust_id,
                customer_name_cache=customer_name_cache
            )
            return cust_id, name
        except Exception:
            return cust_id, None

    with ThreadPoolExecutor(max_workers=10) as executor:
        parallel_results = list(executor.map(fetch_customer_worker, unique_customer_ids))

    for cust_id, name in parallel_results:
        if name:
            customer_name_cache[cust_id] = name

    for cobranca in abertas + atrasadas:
        customer_id = cobranca.get("customer")
        if customer_id and customer_name_cache.get(customer_id):
            cobranca["customerName"] = customer_name_cache[customer_id]

    return {
        "abertas": abertas,
        "atrasadas": atrasadas,
        "recebidas": recebidas,
    }


@router.get(
    "/{integracao_id}/asaas/saldo",
    dependencies=[Depends(require_any_permission(["integracoes:view", "page:integracoes:view", "page:configuracoes:view"]))],
)
def obter_saldo_asaas(
    integracao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    integracao = crud_integracao_bancaria.get(db=db, id=integracao_id, empresa_id=empresa_id)
    if not integracao:
        raise HTTPException(status_code=404, detail="Integração não encontrada")
    if integracao.tipo.upper() != "ASAAS":
        raise HTTPException(status_code=400, detail="Esta integração não é do tipo Asaas")

    try:
        saldo = buscar_saldo_asaas(db=db, integracao=integracao)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar saldo no Asaas: {exc}")

    conta_nome = None
    if integracao.conta_id:
        conta = db.exec(
            select(Conta).where(Conta.id == integracao.conta_id, Conta.empresa_id == empresa_id)
        ).first()
        if conta:
            conta_nome = conta.nome

    return {
        "saldo_asaas": float(saldo.get("saldo") or 0),
        "saldo_bloqueado": float(saldo.get("saldo_bloqueado") or 0),
        "saldo_disponivel": float(saldo.get("saldo_disponivel") or 0),
        "conta_vinculada_id": integracao.conta_id,
        "conta_vinculada_nome": conta_nome,
        "atualizado_em": datetime.utcnow().isoformat(),
    }




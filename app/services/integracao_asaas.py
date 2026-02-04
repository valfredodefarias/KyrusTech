"""
Serviço de integração com Asaas.
Sincroniza pagamentos e recebimentos do Asaas para o sistema.
"""
import requests
from typing import List, Dict, Optional
from datetime import datetime, date
from decimal import Decimal
from loguru import logger

from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade
from app.crud.crud_integracao_bancaria import get_token_decrypted
from sqlmodel import Session, select
import re


# URLs da API Asaas
ASAAS_API_PRODUCAO = "https://api.asaas.com/v3"
ASAAS_API_SANDBOX = "https://sandbox.asaas.com/api/v3"


def get_asaas_base_url(ambiente: str) -> str:
    """Retorna a URL base da API Asaas conforme o ambiente."""
    return ASAAS_API_SANDBOX if ambiente.upper() == "SANDBOX" else ASAAS_API_PRODUCAO


def buscar_movimentacoes_financeiras_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100
) -> List[Dict]:
    """
    Busca movimentações financeiras RECEBIDAS do Asaas (incluindo tipos específicos).
    Retorna lista de movimentações com campo 'type' para mapeamento.
    Filtra apenas movimentações com status RECEIVED (pagos).
    """
    try:
        token = get_token_decrypted(db, integracao=integracao)
        base_url = get_asaas_base_url(integracao.ambiente)
        
        headers = {
            "access_token": token,
            "Content-Type": "application/json"
        }
        
        params = {
            "limit": limit
        }
        
        if data_inicio:
            params["dateCreated[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["dateCreated[le]"] = data_fim.isoformat()
        
        # Busca movimentações financeiras (endpoint que retorna tipos)
        url = f"{base_url}/financialTransactions"
        logger.info(f"Buscando movimentações financeiras RECEBIDAS do Asaas: {url}")
        
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        movimentacoes = data.get("data", [])
        
        # Filtra apenas movimentações RECEBIDAS (pagos)
        movimentacoes_recebidas = [
            m for m in movimentacoes 
            if m.get("status") == "RECEIVED" or m.get("paymentStatus") == "RECEIVED"
        ]
        
        logger.success(f"Encontradas {len(movimentacoes_recebidas)} movimentações RECEBIDAS no Asaas")
        return movimentacoes_recebidas
        
    except requests.exceptions.RequestException as e:
        logger.warning(f"Erro ao buscar movimentações financeiras do Asaas (tentando payments): {e}")
        # Fallback para payments se o endpoint de financialTransactions não existir
        return buscar_pagamentos_asaas(db, integracao, data_inicio, data_fim, limit)
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar movimentações financeiras do Asaas: {e}")
        raise


def buscar_pagamentos_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100
) -> List[Dict]:
    """
    Busca apenas pagamentos RECEBIDOS (pagos) do Asaas.
    
    Args:
        db: Sessão do banco
        integracao: Integração bancária configurada
        data_inicio: Data inicial para buscar (opcional)
        data_fim: Data final para buscar (opcional)
        limit: Limite de registros por página
        
    Returns:
        Lista de pagamentos RECEBIDOS do Asaas
    """
    try:
        token = get_token_decrypted(db, integracao=integracao)
        base_url = get_asaas_base_url(integracao.ambiente)
        
        headers = {
            "access_token": token,
            "Content-Type": "application/json"
        }
        
        params = {
            "limit": limit,
            "status": "RECEIVED"  # APENAS PAGAMENTOS RECEBIDOS (PAGOS)
        }
        
        if data_inicio:
            params["paymentDate[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["paymentDate[le]"] = data_fim.isoformat()
        
        url = f"{base_url}/payments"
        logger.info(f"Buscando pagamentos RECEBIDOS do Asaas: {url}")
        
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        pagamentos = data.get("data", [])
        
        # Filtra apenas os que realmente estão RECEIVED (segurança extra)
        pagamentos_recebidos = [p for p in pagamentos if p.get("status") == "RECEIVED"]
        
        logger.success(f"Encontrados {len(pagamentos_recebidos)} pagamentos RECEBIDOS no Asaas")
        return pagamentos_recebidos
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro ao buscar pagamentos do Asaas: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Resposta do Asaas: {e.response.text}")
        raise ValueError(f"Erro ao conectar com Asaas: {str(e)}")
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar pagamentos do Asaas: {e}")
        raise


def buscar_recebimentos_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100
) -> List[Dict]:
    """
    Busca recebimentos (cobranças pagas) do Asaas.
    Similar a buscar_pagamentos_asaas mas focado em recebimentos.
    """
    try:
        token = get_token_decrypted(db, integracao=integracao)
        base_url = get_asaas_base_url(integracao.ambiente)
        
        headers = {
            "access_token": token,
            "Content-Type": "application/json"
        }
        
        params = {
            "limit": limit,
            "status": "RECEIVED"  # Apenas recebimentos confirmados
        }
        
        if data_inicio:
            params["paymentDate[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["paymentDate[le]"] = data_fim.isoformat()
        
        url = f"{base_url}/payments"
        logger.info(f"Buscando recebimentos do Asaas: {url}")
        
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        recebimentos = data.get("data", [])
        
        logger.success(f"Encontrados {len(recebimentos)} recebimentos no Asaas")
        return recebimentos
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro ao buscar recebimentos do Asaas: {e}")
        raise ValueError(f"Erro ao conectar com Asaas: {str(e)}")
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar recebimentos do Asaas: {e}")
        raise


def buscar_cobrancas_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict]:
    """
    Busca cobranças (payments) no Asaas.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    params: Dict[str, str | int] = {"limit": limit}
    if status:
        params["status"] = status

    url = f"{base_url}/payments"
    logger.info(f"Buscando cobranças do Asaas: {url}")

    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    return data.get("data", [])


def buscar_assinaturas_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict]:
    """
    Busca assinaturas no Asaas.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    params: Dict[str, str | int] = {"limit": limit}
    if status:
        params["status"] = status

    url = f"{base_url}/subscriptions"
    logger.info(f"Buscando assinaturas do Asaas: {url}")

    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    return data.get("data", [])


def converter_pagamento_asaas_para_lancamento(
    db: Session,
    pagamento_asaas: Dict,
    integracao: IntegracaoBancaria,
    empresa_id: int
) -> Dict:
    """
    Converte um pagamento do Asaas para o formato de lançamento do sistema.
    
    Args:
        db: Sessão do banco
        pagamento_asaas: Dados do pagamento do Asaas
        integracao: Integração bancária
        empresa_id: ID da empresa
        
    Returns:
        Dicionário com dados do lançamento pronto para criar
    """
    # Mapeia status do Asaas para nosso sistema
    status_map = {
        "PENDING": "PENDENTE",
        "RECEIVED": "PAGO",
        "OVERDUE": "VENCIDO",
        "REFUNDED": "CANCELADO"
    }
    
    # O tipo pode vir em diferentes campos dependendo do endpoint usado
    tipo_movimentacao = (
        pagamento_asaas.get("type") or 
        pagamento_asaas.get("transactionType") or 
        pagamento_asaas.get("transactionTypeCode")
    )
    
    # Determina tipo (RECEITA ou DESPESA) baseado no valor e tipo de movimentação
    # Valores negativos geralmente são DESPESAS, positivos são RECEITAS
    valor_bruto = Decimal(str(pagamento_asaas.get("value", 0)))
    tipo = "DESPESA" if valor_bruto < 0 else "RECEITA"
    
    # Busca categoria mapeada por tipo do Asaas
    plano_contas_id = None
    
    # PRIMEIRO: Tenta mapear por tipo (ex: TRANSFER_FEE, ASAAS_CARD_RECHARGE, etc.)
    if tipo_movimentacao:
        # Normaliza o tipo para maiúsculas
        tipo_upper = str(tipo_movimentacao).upper().strip()
        logger.info(f"🔍 Buscando mapeamento para tipo: '{tipo_upper}'")
        
        mapeamento_tipo = db.exec(
            select(MapeamentoCategoria).where(
                MapeamentoCategoria.integracao_id == integracao.id,
                MapeamentoCategoria.categoria_externa == tipo_upper
            )
        ).first()
        
        if mapeamento_tipo:
            plano_contas_id = mapeamento_tipo.plano_contas_id
            logger.info(f"✅ Categoria mapeada por tipo '{tipo_upper}' -> ID: {plano_contas_id}")
        else:
            logger.warning(f"⚠️ Tipo '{tipo_upper}' NÃO encontrado nos mapeamentos da integração {integracao.id}")
    
    # Se não encontrou por tipo, tenta por descrição
    if not plano_contas_id:
        categoria_externa = pagamento_asaas.get("description", "").lower()
        if categoria_externa:
            mapeamento = db.exec(
                select(MapeamentoCategoria).where(
                    MapeamentoCategoria.integracao_id == integracao.id,
                    MapeamentoCategoria.categoria_externa.ilike(f"%{categoria_externa}%")
                )
            ).first()
            
            if mapeamento:
                plano_contas_id = mapeamento.plano_contas_id
                logger.info(f"Categoria mapeada por descrição: {categoria_externa} -> {mapeamento.plano_contas_id}")
    
    # Se não encontrou mapeamento, usa categoria padrão ou "A Categorizar"
    # IMPORTANTE: plano_contas_id NUNCA pode ser None (viola constraint NOT NULL)
    if not plano_contas_id:
        if integracao.categoria_padrao_id:
            plano_contas_id = integracao.categoria_padrao_id
            logger.info(f"Usando categoria padrão da integração: {plano_contas_id}")
        elif integracao.usar_categoria_a_categorizar:
            # Busca categoria "A Categorizar" ou cria se não existir
            categoria_a_categorizar = db.exec(
                select(PlanoContas).where(
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.nome.ilike("%categorizar%"),
                    PlanoContas.tipo == ("D" if tipo == "DESPESA" else "R")
                )
            ).first()
            
            if categoria_a_categorizar:
                plano_contas_id = categoria_a_categorizar.id
            else:
                # Cria categoria "A Categorizar" se não existir
                categoria_a_categorizar = PlanoContas(
                    nome="A Categorizar",
                    tipo="D" if tipo == "DESPESA" else "R",
                    empresa_id=empresa_id,
                    permite_lancamentos=True
                )
                db.add(categoria_a_categorizar)
                db.commit()
                db.refresh(categoria_a_categorizar)
                plano_contas_id = categoria_a_categorizar.id
                logger.info(f"Categoria 'A Categorizar' criada: ID {plano_contas_id}")
        else:
            # Fallback: busca qualquer categoria do tipo correto ou cria "A Categorizar"
            categoria_fallback = db.exec(
                select(PlanoContas).where(
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.tipo == ("D" if tipo == "DESPESA" else "R"),
                    PlanoContas.permite_lancamentos == True
                )
            ).first()
            
            if categoria_fallback:
                plano_contas_id = categoria_fallback.id
                logger.warning(f"Usando categoria fallback: {categoria_fallback.nome} (ID: {plano_contas_id})")
            else:
                # Último recurso: cria "A Categorizar"
                categoria_a_categorizar = PlanoContas(
                    nome="A Categorizar",
                    tipo="D" if tipo == "DESPESA" else "R",
                    empresa_id=empresa_id,
                    permite_lancamentos=True
                )
                db.add(categoria_a_categorizar)
                db.commit()
                db.refresh(categoria_a_categorizar)
                plano_contas_id = categoria_a_categorizar.id
                logger.warning(f"Criada categoria 'A Categorizar' como último recurso: ID {plano_contas_id}")
    
    # Garantia final: se ainda não tem plano_contas_id, lança erro
    if not plano_contas_id:
        # Última tentativa: busca qualquer categoria que permita lançamentos
        categoria_emergencia = db.exec(
            select(PlanoContas).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.permite_lancamentos == True
            ).limit(1)
        ).first()
        
        if categoria_emergencia:
            plano_contas_id = categoria_emergencia.id
            logger.warning(f"Usando categoria de emergência: {categoria_emergencia.nome} (ID: {plano_contas_id})")
        else:
            raise ValueError(
                f"Não foi possível determinar categoria para lançamento do Asaas. "
                f"Tipo: {tipo}, Empresa: {empresa_id}. "
                f"Configure uma categoria padrão na integração ou crie categorias no plano de contas."
            )
    
    # Converte datas - USA O CAMPO "date" DA API DO ASAAS
    # O campo "date" da financialTransaction é a data da movimentação
    data_movimentacao = None
    
    # Prioridade: campo "date" (da financialTransaction) → "paymentDate" → "dueDate"
    if pagamento_asaas.get("date"):
        try:
            # O campo "date" vem no formato "YYYY-MM-DD"
            data_movimentacao = datetime.strptime(pagamento_asaas["date"], "%Y-%m-%d").date()
            logger.info(f"📅 Data encontrada no campo 'date': {data_movimentacao}")
        except Exception as e:
            logger.warning(f"Erro ao converter campo 'date': {e}")
    
    # Fallback para outros campos de data
    if not data_movimentacao:
        if pagamento_asaas.get("paymentDate"):
            try:
                data_movimentacao = datetime.fromisoformat(pagamento_asaas["paymentDate"].replace("Z", "+00:00")).date()
            except:
                pass
        elif pagamento_asaas.get("dueDate"):
            try:
                data_movimentacao = datetime.fromisoformat(pagamento_asaas["dueDate"].replace("Z", "+00:00")).date()
            except:
                pass
    
    # Para financialTransactions, sempre são movimentações já realizadas (PAGAS)
    # Usa a mesma data para vencimento e pagamento
    data_vencimento = data_movimentacao or date.today()
    data_pagamento = data_movimentacao or date.today()
    
    # Status sempre PAGO para financialTransactions (já são movimentações realizadas)
    status_final = "PAGO"
    
    # Valor: usa o campo "value" (pode ser negativo para despesas)
    # Para despesas (negativas), converte para positivo
    valor_absoluto = abs(valor_bruto)
    valor_pago = valor_absoluto
    valor_previsto = valor_absoluto
    
    logger.info(f"💰 Valor: {valor_bruto} -> Valor Absoluto: {valor_absoluto} | Tipo: {tipo}")
    
    # Cria ou busca entidade do banco (Asaas)
    entidade_id = criar_entidade_banco_asaas(db, empresa_id)
    
    # Garante que conta_id e centro_custo_id estão preenchidos
    conta_id = integracao.conta_id
    centro_custo_id = integracao.centro_custo_id
    
    if not conta_id:
        logger.warning(f"⚠️ Integração {integracao.id} não tem conta_id configurado")
    if not centro_custo_id:
        logger.warning(f"⚠️ Integração {integracao.id} não tem centro_custo_id configurado")
    
    # VALIDAÇÃO FINAL: Garante que AMBAS as datas estão preenchidas (OBRIGATÓRIO)
    if not data_vencimento:
        data_vencimento = date.today()
        logger.warning(f"⚠️ Data de vencimento não encontrada, usando data atual: {data_vencimento}")
    
    if not data_pagamento:
        data_pagamento = data_vencimento or date.today()
        logger.warning(f"⚠️ Data de pagamento não encontrada, usando: {data_pagamento}")
    
    # Confirma que ambas as datas estão preenchidas
    assert data_vencimento is not None, "Data de vencimento deve estar preenchida"
    assert data_pagamento is not None, "Data de pagamento deve estar preenchida"
    
    lancamento_data = {
        "descricao": pagamento_asaas.get("description", "Lançamento do Asaas"),
        "tipo": tipo,
        "status": status_final,
        "origem": "ASAAS",
        "valor_previsto": valor_previsto,  # Valor absoluto do campo "value"
        "valor_pago": valor_pago,  # Mesmo valor (já é pago)
        "data_vencimento": data_vencimento,  # ✅ Campo "date" da API
        "data_pagamento": data_pagamento,  # ✅ Mesma data (campo "date")
        "data_competencia": data_pagamento or data_vencimento or date.today(),
        "observacao": f"Asaas ID: {pagamento_asaas.get('id')} | Tipo: {tipo_movimentacao}",
        "empresa_id": empresa_id,
        "plano_contas_id": plano_contas_id,  # ✅ Mapeado pelo tipo
        "conta_id": conta_id,  # ✅ Conta bancária da integração
        "centro_custo_id": centro_custo_id,  # ✅ Centro de custo da integração
        "entidade_id": entidade_id,  # Entidade do banco (Asaas)
        "ipp": False
    }
    
    logger.info(
        f"✅ Lançamento convertido: {lancamento_data['descricao'][:50]} | "
        f"Categoria: {plano_contas_id} | "
        f"Conta: {conta_id} | "
        f"Centro Custo: {centro_custo_id} | "
        f"Valor Pago: {valor_pago} | "
        f"Data Vencimento: {data_vencimento} | "
        f"Data Pagamento: {data_pagamento}"
    )
    
    return lancamento_data


def criar_entidade_banco_asaas(db: Session, empresa_id: int) -> Optional[int]:
    """
    Cria ou busca entidade do banco Asaas.
    Retorna o ID da entidade.
    """
    nome_banco = "Asaas"
    
    # Busca entidade existente
    entidade = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.nome.ilike(f"%{nome_banco}%")
        )
    ).first()
    
    if entidade:
        return entidade.id
    
    # Cria nova entidade para o banco
    nova_entidade = Entidade(
        nome=nome_banco,
        tipo="FORNECEDOR",  # Banco é fornecedor de serviços
        cpf_cnpj=None,  # Asaas não tem CNPJ único, é uma plataforma
        status="ATIVO",
        empresa_id=empresa_id
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)
    
    logger.info(f"Entidade do banco criada: {nova_entidade.nome} (ID: {nova_entidade.id})")
    return nova_entidade.id


def sincronizar_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None
) -> Dict:
    """
    Sincroniza pagamentos e recebimentos do Asaas.
    Cria lançamentos no sistema.
    
    Returns:
        Dicionário com estatísticas da sincronização
    """
    logger.info(f"Iniciando sincronização Asaas para integração ID: {integracao.id}")
    
    try:
        # Tenta buscar movimentações financeiras primeiro (tem tipos específicos)
        try:
            movimentacoes = buscar_movimentacoes_financeiras_asaas(
                db=db,
                integracao=integracao,
                data_inicio=data_inicio,
                data_fim=data_fim
            )
            pagamentos = movimentacoes
        except:
            # Fallback para payments se não conseguir buscar movimentações
            pagamentos = buscar_pagamentos_asaas(
                db=db,
                integracao=integracao,
                data_inicio=data_inicio,
                data_fim=data_fim
            )
        
        # Converte e cria lançamentos
        lancamentos_criados = 0
        lancamentos_atualizados = 0
        erros = []
        
        for pagamento in pagamentos:
            try:
                # Log do pagamento recebido para debug
                asaas_id = pagamento.get("id")
                tipo_mov = pagamento.get("type") or pagamento.get("transactionType") or pagamento.get("transactionTypeCode")
                logger.debug(f"Processando pagamento Asaas ID: {asaas_id}, Tipo: {tipo_mov}, Status: {pagamento.get('status')}")
                
                # Converte para formato de lançamento
                lancamento_data = converter_pagamento_asaas_para_lancamento(
                    db=db,
                    pagamento_asaas=pagamento,
                    integracao=integracao,
                    empresa_id=integracao.empresa_id
                )
                
                # Verifica se já existe (pelo ID externo do Asaas)
                observacao_asaas = f"Asaas ID: {asaas_id}"
                
                # Busca lançamento existente
                lancamento_existente = db.exec(
                    select(Lancamento).where(
                        Lancamento.empresa_id == integracao.empresa_id,
                        Lancamento.observacao.contains(asaas_id)
                    )
                ).first()
                
                if lancamento_existente:
                    # Atualiza lançamento existente
                    # IMPORTANTE: Se o lançamento já tem uma categoria válida e o novo mapeamento encontrou uma categoria,
                    # atualiza para usar a categoria mapeada (isso permite corrigir lançamentos que estavam "A Categorizar")
                    
                    # Atualiza plano_contas_id se encontrou um mapeamento válido
                    if lancamento_data.get("plano_contas_id"):
                        lancamento_existente.plano_contas_id = lancamento_data.get("plano_contas_id")
                        logger.info(f"✅ Atualizando plano_contas_id do lançamento {lancamento_existente.id} de '{lancamento_existente.plano_contas_id}' para '{lancamento_data.get('plano_contas_id')}'")
                    
                    # Atualiza outros campos importantes
                    lancamento_existente.valor_pago = lancamento_data.get("valor_pago", lancamento_existente.valor_pago)
                    lancamento_existente.data_pagamento = lancamento_data.get("data_pagamento") or lancamento_existente.data_pagamento
                    lancamento_existente.data_vencimento = lancamento_data.get("data_vencimento") or lancamento_existente.data_vencimento
                    lancamento_existente.status = lancamento_data.get("status", lancamento_existente.status)
                    
                    # Garante que conta_id seja definido se a integração tiver uma conta
                    if integracao.conta_id:
                        lancamento_existente.conta_id = integracao.conta_id
                        logger.info(f"Atualizando conta_id do lançamento {lancamento_existente.id} para {integracao.conta_id}")
                    
                    # Garante que centro_custo_id seja definido se a integração tiver um centro de custo
                    if integracao.centro_custo_id:
                        lancamento_existente.centro_custo_id = integracao.centro_custo_id
                        logger.info(f"Atualizando centro_custo_id do lançamento {lancamento_existente.id} para {integracao.centro_custo_id}")
                    
                    # Garante que entidade_id seja definido se não tiver
                    if lancamento_data.get("entidade_id"):
                        lancamento_existente.entidade_id = lancamento_data.get("entidade_id")
                    
                    # Validação final: garante que plano_contas_id não seja None
                    if not lancamento_existente.plano_contas_id:
                        raise ValueError(f"Lançamento {lancamento_existente.id} não pode ter plano_contas_id None")
                    
                    db.add(lancamento_existente)
                    lancamentos_atualizados += 1
                else:
                    # Cria novo lançamento
                    # Garante que conta_id está definido
                    if not lancamento_data.get("conta_id") and integracao.conta_id:
                        lancamento_data["conta_id"] = integracao.conta_id
                    
                    # Validação final: garante que plano_contas_id não seja None
                    if not lancamento_data.get("plano_contas_id"):
                        raise ValueError(f"Não é possível criar lançamento sem plano_contas_id. Dados: {lancamento_data.get('descricao')}")
                    
                    lancamento = Lancamento(**lancamento_data)
                    db.add(lancamento)
                    lancamentos_criados += 1
                
            except Exception as e:
                logger.error(f"Erro ao processar pagamento Asaas {pagamento.get('id')}: {e}")
                erros.append(str(e))
                # Faz rollback da transação atual para evitar problemas em cascata
                db.rollback()
                # Continua processando os próximos lançamentos
                continue
        
        # Commit das mudanças (apenas se não houver erros críticos)
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Erro ao fazer commit das mudanças: {e}")
            db.rollback()
            raise
        
        # Atualiza última sincronização
        from app.crud.crud_integracao_bancaria import atualizar_ultima_sincronizacao
        atualizar_ultima_sincronizacao(db, integracao=integracao, sucesso=True)
        
        resultado = {
            "sucesso": True,
            "lancamentos_criados": lancamentos_criados,
            "lancamentos_atualizados": lancamentos_atualizados,
            "total_processado": len(pagamentos),
            "erros": erros
        }
        
        logger.success(
            f"Sincronização Asaas concluída: {lancamentos_criados} criados, "
            f"{lancamentos_atualizados} atualizados"
        )
        
        return resultado
        
    except Exception as e:
        logger.error(f"Erro na sincronização Asaas: {e}")
        # Faz rollback antes de tentar atualizar última sincronização
        try:
            db.rollback()
        except:
            pass
        
        # Atualiza última sincronização (recarrega a integração para evitar problemas de sessão)
        try:
            from app.crud.crud_integracao_bancaria import atualizar_ultima_sincronizacao
            from app.models.integracao_bancaria import IntegracaoBancaria
            # Recarrega a integração para garantir que está na sessão atual
            integracao_refreshed = db.get(IntegracaoBancaria, integracao.id)
            if integracao_refreshed:
                atualizar_ultima_sincronizacao(db, integracao=integracao_refreshed, sucesso=False)
        except Exception as update_error:
            logger.error(f"Erro ao atualizar última sincronização: {update_error}")
            # Tenta fazer rollback novamente se houver erro
            try:
                db.rollback()
            except:
                pass
        
        raise




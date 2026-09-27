from typing import List, Dict, Any, Optional
from datetime import date
from sqlmodel import Session, select, func
from pydantic import BaseModel
from decimal import Decimal

from app.models.lancamento_cartao import LancamentoCartao
from app.models.lancamento import Lancamento
from app.models.cartao import Cartao
from app.models.conta import Conta
import calendar

def calcular_vencimento_fatura(data_compra: date, dia_fechamento: int, dia_vencimento: int) -> date:
    """
    Calcula a data de vencimento da fatura para uma dada data de compra.
    - Se o dia da compra > dia_fechamento: cai na próxima fatura (+1 mês).
    - Se o dia_vencimento <= dia_fechamento: significa que vence no mês seguinte ao fechamento (+1 mês).
    - Ajusta final de semana para próximo dia útil.
    """
    y = data_compra.year
    m = data_compra.month
    d = data_compra.day
    
    statement_offset = 1 if d > dia_fechamento else 0
    due_offset = statement_offset + (1 if dia_vencimento <= dia_fechamento else 0)
    
    month_index = m - 1 + due_offset
    
    y += month_index // 12
    m = (month_index % 12) + 1
    
    _, days_in_month = calendar.monthrange(y, m)
    day = min(dia_vencimento, days_in_month)
    
    computed_date = date(y, m, day)
    
    # Ajusta fim de semana (5=Sábado, 6=Domingo) -> Segunda
    while computed_date.weekday() >= 5:
        import datetime
        computed_date += datetime.timedelta(days=1)
        
    return computed_date

def avancar_meses_fatura(data_base: date, meses: int, dia_vencimento: int) -> date:
    """ Avança a data base N meses mantendo o dia de vencimento (ou o limite do mês) """
    if meses == 0:
        return data_base
        
    y = data_base.year
    m = data_base.month
    
    month_index = m - 1 + meses
    y += month_index // 12
    m = (month_index % 12) + 1
    
    _, days_in_month = calendar.monthrange(y, m)
    day = min(dia_vencimento, days_in_month)
    
    computed_date = date(y, m, day)
    while computed_date.weekday() >= 5:
        import datetime
        computed_date += datetime.timedelta(days=1)
        
    return computed_date



class FaturaVirtual(BaseModel):
    cartao_id: int
    nome_cartao: str
    bandeira: Optional[str]
    competencia_fatura: str
    data_vencimento_fatura: date
    valor_total: Decimal
    quantidade_compras: int


def get_faturas_virtuais_abertas(
    session: Session, 
    empresa_id: int, 
    competencia: str = None,
    data_inicio: date = None,
    data_fim: date = None,
) -> List[FaturaVirtual]:
    """
    Agrupa todos os lançamentos de cartão que ainda NÃO foram pagos,
    gerando "Faturas Virtuais" para exibição no Contas a Pagar.
    Otimizado para filtrar por período de vencimento quando fornecido.
    """
    query = (
        select(
            LancamentoCartao.cartao_id,
            Cartao.nome_cartao,
            Cartao.bandeira,
            LancamentoCartao.competencia_fatura,
            LancamentoCartao.data_vencimento_fatura,
            func.sum(LancamentoCartao.valor).label("valor_total"),
            func.count(LancamentoCartao.id).label("quantidade_compras")
        )
        .join(Cartao, Cartao.id == LancamentoCartao.cartao_id)
        .where(
            LancamentoCartao.empresa_id == empresa_id,
            LancamentoCartao.fatura_paga == False,
            LancamentoCartao.is_deleted == False,
            LancamentoCartao.deleted_at.is_(None)
        )
    )
    
    if competencia:
        query = query.where(LancamentoCartao.competencia_fatura == competencia)
    if data_inicio:
        query = query.where(LancamentoCartao.data_vencimento_fatura >= data_inicio)
    if data_fim:
        query = query.where(LancamentoCartao.data_vencimento_fatura <= data_fim)
        
    query = query.group_by(
        LancamentoCartao.cartao_id,
        Cartao.nome_cartao,
        Cartao.bandeira,
        LancamentoCartao.competencia_fatura,
        LancamentoCartao.data_vencimento_fatura
    )
    
    resultados = session.execute(query).all()
    
    faturas = []
    for row in resultados:
        faturas.append(FaturaVirtual(
            cartao_id=row.cartao_id,
            nome_cartao=row.nome_cartao,
            bandeira=row.bandeira,
            competencia_fatura=row.competencia_fatura,
            data_vencimento_fatura=row.data_vencimento_fatura,
            valor_total=row.valor_total,
            quantidade_compras=row.quantidade_compras
        ))
        
    return faturas


def pagar_fatura(
    session: Session,
    empresa_id: int,
    cartao_id: int,
    competencia_fatura: str,
    conta_pagamento_id: int,
    data_pagamento: date
) -> List[Lancamento]:
    """
    Realiza o pagamento de uma fatura inteira.
    Pega todos os LancamentoCartao daquela fatura, marca como pagos,
    e INJETA eles na tabela Lancamento para que apareçam no DRE e Fluxo de Caixa.
    """
    
    # 0. Valida se o cartão e a conta de pagamento pertencem à mesma empresa
    cartao = session.exec(
        select(Cartao).where(
            Cartao.id == cartao_id,
            Cartao.empresa_id == empresa_id,
            Cartao.is_deleted == False
        )
    ).first()
    if not cartao:
        raise ValueError("Cartão não encontrado ou não pertence a esta empresa.")

    conta = session.exec(
        select(Conta).where(
            Conta.id == conta_pagamento_id,
            Conta.empresa_id == empresa_id,
            Conta.is_deleted == False
        )
    ).first()
    if not conta:
        raise ValueError("Conta de pagamento inválida ou não pertence a esta empresa.")

    # 1. Busca os lançamentos do cartão que estão na fatura
    despesas_cartao = session.exec(
        select(LancamentoCartao)
        .where(
            LancamentoCartao.empresa_id == empresa_id,
            LancamentoCartao.cartao_id == cartao_id,
            LancamentoCartao.competencia_fatura == competencia_fatura,
            LancamentoCartao.fatura_paga == False,
            LancamentoCartao.is_deleted == False,
            LancamentoCartao.deleted_at.is_(None)
        )
    ).all()
    
    if not despesas_cartao:
        raise ValueError("Nenhum lançamento em aberto encontrado para esta fatura.")
        
    novos_lancamentos_financeiros = []
    
    for despesa in despesas_cartao:
        # 2. Transfere para a tabela Lancamento (Financeiro)
        # O status já vai como PAGO, com a data_pagamento correta
        if despesa.regime_competencia == 'COMPRA':
            competencia_contabil = despesa.data_compra.strftime('%Y-%m')
            data_competencia_contabil = despesa.data_compra
        else:
            competencia_contabil = despesa.competencia_fatura
            data_competencia_contabil = despesa.data_vencimento_fatura

        novo_lancamento = Lancamento(
            empresa_id=empresa_id,
            descricao=f"{despesa.descricao} (Fatura {competencia_fatura})",
            tipo="DESPESA",
            status="PAGO",
            origem="CARTAO_PAGAMENTO",
            valor_previsto=despesa.valor,
            valor_pago=despesa.valor,
            data_vencimento=despesa.data_vencimento_fatura,
            data_pagamento=data_pagamento,
            data_competencia=data_competencia_contabil,
            competencia=competencia_contabil,
            plano_contas_id=despesa.plano_contas_id,
            conta_id=conta_pagamento_id,
            cartao_id=cartao_id,
            centro_custo_id=despesa.centro_custo_id,
            entidade_id=despesa.entidade_id,
            import_hash=despesa.import_hash,
            ofx_bank_id=despesa.ofx_bank_id
        )
        session.add(novo_lancamento)
        session.flush() # Para pegar o ID inserido
        
        # 3. Atualiza o LancamentoCartao para saber que foi pago
        despesa.fatura_paga = True
        despesa.lancamento_pagamento_id = novo_lancamento.id
        session.add(despesa)
        
        novos_lancamentos_financeiros.append(novo_lancamento)
        
    session.commit()
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id, force=True)
    
    return novos_lancamentos_financeiros

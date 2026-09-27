# app/crud/crud_lancamento.py

from typing import List, Optional
import datetime
from decimal import Decimal
from sqlmodel import Session, select, col, func

from app.models.lancamento import Lancamento
from app.models.entidade import Entidade
from app.models.conta import Conta
from app.models.cartao import Cartao
from app.models.plano_contas import PlanoContas
from app.schemas.lancamento import LancamentoCreate, LancamentoRead, LancamentoUpdate, TransferenciaCreate


def _categoria_eh_receita(tipo_categoria: Optional[str]) -> bool:
    return (tipo_categoria or "").strip().upper().startswith("R")


def _get_categoria_id_por_tipo(db: Session, empresa_id: int, tipo: str, preferencia_nome: Optional[str] = None) -> Optional[int]:
    if preferencia_nome:
        categoria_id = db.exec(
            select(PlanoContas.id).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.tipo == tipo,
                PlanoContas.nome.ilike(preferencia_nome),
            )
        ).first()
        if categoria_id is not None:
            return int(categoria_id)

    categoria_id = db.exec(
        select(PlanoContas.id).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == tipo,
        )
    ).first()
    return int(categoria_id) if categoria_id is not None else None

# --- HELPER: REGRAS DE NEGÓCIO ---
def _aplicar_regras_negocio(db: Session, obj_in):
    """Define Tipo e Status automaticamente."""
    
    # 1. Regra do Tipo (Receita/Despesa) baseada na Categoria
    if hasattr(obj_in, 'plano_contas_id') and obj_in.plano_contas_id:
        categoria = db.get(PlanoContas, obj_in.plano_contas_id)
        if categoria:
            obj_in.tipo = "RECEITA" if _categoria_eh_receita(categoria.tipo) else "DESPESA"

    # 2. Regra do Status baseada na Data de Pagamento
    if obj_in.data_pagamento:
        obj_in.status = "PAGO"
        if not obj_in.valor_pago:
            obj_in.valor_pago = obj_in.valor_previsto
    else:
        obj_in.status = "EM ABERTO"
        obj_in.valor_pago = 0
    
    return obj_in

# --- LEITURA ---
def get_by_empresa(db: Session, *, empresa_id: int, skip: int = 0, limit: int = 2000) -> List[LancamentoRead]:
    statement = (
        select(Lancamento, Entidade.nome, Conta.nome, Cartao.nome_cartao, PlanoContas.nome) # type: ignore
        .outerjoin(Entidade, Lancamento.entidade_id == Entidade.id)
        .outerjoin(Conta, Lancamento.conta_id == Conta.id)
        .outerjoin(Cartao, Lancamento.cartao_id == Cartao.id)
        .join(PlanoContas, Lancamento.plano_contas_id == PlanoContas.id)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        .order_by(Lancamento.data_vencimento)
        .offset(skip).limit(limit)
    )
    results = db.exec(statement).all()
    lista = []
    for row in results:
        lanc, n_ent, n_conta, n_cart, n_cat = row
        item = LancamentoRead.model_validate(lanc)
        item.nome_entidade = n_ent
        item.nome_conta = n_conta
        item.nome_cartao = n_cart
        item.nome_plano_contas = n_cat
        lista.append(item)
    return lista

# --- CRIAÇÃO E ATUALIZAÇÃO ---

def create_lancamento(db: Session, *, obj_in: LancamentoCreate, empresa_id: int) -> Lancamento:
    if not obj_in.data_competencia:
        obj_in.data_competencia = obj_in.data_vencimento
    
    # Aplica automações
    obj_in = _aplicar_regras_negocio(db, obj_in)

    data = obj_in.model_dump()
    data["empresa_id"] = empresa_id
    db_obj = Lancamento.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update_lancamento(db: Session, *, id: int, obj_in: LancamentoUpdate, empresa_id: int) -> Optional[Lancamento]:
    db_obj = db.get(Lancamento, id)
    if not db_obj or db_obj.empresa_id != empresa_id or getattr(db_obj, "is_deleted", False):
        return None
    
    # Atualiza os campos no objeto antes de salvar
    dados_update = obj_in.model_dump(exclude_unset=True)
    for key, value in dados_update.items():
        setattr(db_obj, key, value)

    # Reaplica regras (ex: se o usuário apagou a data de pagamento, volta pra Pendente)
    if db_obj.data_pagamento:
        db_obj.status = "PAGO"
    else:
        db_obj.status = "PENDENTE"
        db_obj.valor_pago = 0
    
    # Se trocou categoria, atualiza tipo
    if 'plano_contas_id' in dados_update:
        cat = db.get(PlanoContas, db_obj.plano_contas_id)
        if cat:
            db_obj.tipo = "RECEITA" if _categoria_eh_receita(cat.tipo) else "DESPESA"

    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

# --- OPERAÇÕES EM MASSA (BULK) ---

def create_multi(db: Session, *, list_obj_in: List[LancamentoCreate], empresa_id: int) -> List[Lancamento]:
    """Cria múltiplos lançamentos (usado para parcelamento)."""
    objs = []
    for item in list_obj_in:
        # --- CORREÇÃO: Preencher data_competencia se faltar ---
        if not item.data_competencia:
            item.data_competencia = item.data_vencimento
        # ------------------------------------------------------

        # Garante a empresa e converte para o modelo do banco
        db_obj = Lancamento.model_validate(item, update={"empresa_id": empresa_id})
        
        # Aplica regras de negócio (status, tipo)
        db_obj = _aplicar_regras_negocio(db, db_obj)
        
        db.add(db_obj)
        objs.append(db_obj)
    
    db.commit()
    for obj in objs:
        db.refresh(obj)
    return objs
def delete_multi(db: Session, *, ids: List[int], empresa_id: int):
    """
    Deleta (soft-delete) múltiplos lançamentos verificando se pertencem à empresa.
    """
    statement = select(Lancamento).where(
        col(Lancamento.id).in_(ids), 
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False
    )
    results = db.exec(statement).all()
    
    count = 0
    now = datetime.datetime.utcnow()
    for item in results:
        item.is_deleted = True
        item.deleted_at = now
        db.add(item)
        count += 1
        
    db.commit()
    return {"ok": True, "deleted_count": count}

def pay_multi(db: Session, *, ids: List[int], data_pagamento: str, empresa_id: int, conta_id: Optional[int] = None):
    """
    1. Marca os lançamentos do cartão como PAGOS.
    2. Se 'conta_id' for informado, CRIA UM SAQUE na conta bancária no valor total.
    """
    lancamentos = db.exec(
        select(Lancamento).where(
            col(Lancamento.id).in_(ids),
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
    ).all()
    
    total_fatura = Decimal(0)
    data_final = datetime.date.today()
    if isinstance(data_pagamento, str):
        try: data_final = datetime.date.fromisoformat(data_pagamento)
        except: pass
    
    qtd_atualizados = 0

    for item in lancamentos:
        if item.status != "PAGO":
            item.status = "PAGO"
            item.data_pagamento = data_final
            if not item.valor_pago: item.valor_pago = item.valor_previsto
            
            # Soma ao total da fatura
            total_fatura += item.valor_pago
            
            db.add(item)
            qtd_atualizados += 1
    
    # --- CRIAÇÃO DO PAGAMENTO DA FATURA (SAÍDA DA CONTA) ---
    if conta_id and total_fatura > 0:
        cat_fatura_id = _get_categoria_id_por_tipo(db, empresa_id, 'D', "%cart%")

        pagamento_saida = Lancamento(
            descricao=f"Pagamento de Fatura/Lançamentos ({qtd_atualizados} itens)",
            tipo="DESPESA",
            valor_previsto=total_fatura,
            valor_pago=total_fatura,
            data_vencimento=data_final,
            data_pagamento=data_final,
            data_competencia=data_final,
            status="PAGO",
            conta_id=conta_id,
            plano_contas_id=cat_fatura_id or 1,
            empresa_id=empresa_id,
            origem="BAIXA_FATURA"
        )
        db.add(pagamento_saida)

    db.commit()
    return {"ok": True, "updated": qtd_atualizados, "total_pago": float(total_fatura)}

# --- TRANSFERÊNCIA ---

def realizar_transferencia(db: Session, *, transf_in: TransferenciaCreate, empresa_id: int):
    # 1. Define status e data
    status_transf = "PAGO"
    data_pgto = transf_in.data

    # 2. Busca e valida contas (Origem e Destino com isolamento multi-tenant)
    conta_origem = db.get(Conta, transf_in.conta_origem_id)
    conta_destino = db.get(Conta, transf_in.conta_destino_id)
    if not conta_origem or conta_origem.empresa_id != empresa_id or getattr(conta_origem, "is_deleted", False):
        raise ValueError("Conta de origem inválida ou não pertencente a esta empresa.")
    if not conta_destino or conta_destino.empresa_id != empresa_id or getattr(conta_destino, "is_deleted", False):
        raise ValueError("Conta de destino inválida ou não pertencente a esta empresa.")
    if transf_in.conta_origem_id == transf_in.conta_destino_id:
        raise ValueError("Selecione contas diferentes para a transferência.")

    # 3. Busca categorias padrão se nulo
    cat_id = transf_in.plano_contas_id
    cat_saida_id = cat_id or _get_categoria_id_por_tipo(db, empresa_id, 'D', '%transfer%') or 1
    cat_entrada_id = cat_id or _get_categoria_id_por_tipo(db, empresa_id, 'R', '%transfer%') or 1

    nome_origem = conta_origem.nome
    nome_destino = conta_destino.nome
    competencia = transf_in.data.strftime("%Y-%m")

    # 4. Cria Saída (Despesa na Origem)
    saida = Lancamento(
        descricao=f"Transf. de {nome_origem} p/ {nome_destino}", 
        tipo="DESPESA", 
        valor_previsto=transf_in.valor, 
        valor_pago=transf_in.valor,
        data_vencimento=transf_in.data, 
        data_pagamento=data_pgto,
        data_competencia=transf_in.data, 
        competencia=competencia,
        status=status_transf,
        conta_id=transf_in.conta_origem_id, 
        plano_contas_id=cat_saida_id, 
        empresa_id=empresa_id, 
        origem="TRANSFERENCIA",
        centro_custo_id=transf_in.centro_custo_id,
        observacao=transf_in.observacao,
    )
    
    # 5. Cria Entrada (Receita no Destino)
    entrada = Lancamento(
        descricao=f"Transf. de {nome_origem} p/ {nome_destino}", 
        tipo="RECEITA", 
        valor_previsto=transf_in.valor, 
        valor_pago=transf_in.valor,
        data_vencimento=transf_in.data, 
        data_pagamento=data_pgto,
        data_competencia=transf_in.data, 
        competencia=competencia,
        status=status_transf,
        conta_id=transf_in.conta_destino_id, 
        plano_contas_id=cat_entrada_id, 
        empresa_id=empresa_id, 
        origem="TRANSFERENCIA",
        centro_custo_id=transf_in.centro_custo_id,
        observacao=transf_in.observacao,
    )

    db.add(saida)
    db.add(entrada)
    db.commit()
    return {"ok": True}
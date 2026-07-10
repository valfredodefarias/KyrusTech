# app/api/v1/endpoints/comissao_config.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Dict, Any, Optional
from datetime import date
from decimal import Decimal
from pydantic import BaseModel

from app.db.session import get_db
from app.api.v1.deps import get_current_active_user
from app.models.usuario import Usuario
from app.models.regra_comissao import RegraComissao
from app.models.meta_vendedor import MetaVendedor
from app.models.centro_custo import CentroCusto

router = APIRouter()

# --- SCHEMAS ---
class RegraComissaoCreate(BaseModel):
    centro_custo_id: Optional[int] = None
    taxa_servico: Decimal
    dias_tolerancia_atraso: int
    redutor_atraso_intermediario_pct: Decimal
    dias_limite_atraso: int
    faixas_produtos_json: str
    retroativo: bool = False

class MetaVendedorCreate(BaseModel):
    vendedor_id: int
    mes: int
    ano: int
    valor_meta: Decimal

# --- ENDPOINTS ---

@router.get("/regras")
def get_regras(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Retorna todas as regras de comissão ativas da empresa.
    """
    empresa_id = current_user.empresa_id
    
    query = (
        select(RegraComissao)
        .where(
            RegraComissao.empresa_id == empresa_id,
            RegraComissao.is_deleted == False
        )
        .order_by(RegraComissao.data_inicio.desc())
    )
    regras = db.exec(query).all()
    
    # Adicionar nome do centro de custo se existir
    cc_ids = {r.centro_custo_id for r in regras if r.centro_custo_id is not None}
    cc_map = {}
    if cc_ids:
        query_cc = select(CentroCusto).where(CentroCusto.id.in_(list(cc_ids)))
        cc_list = db.exec(query_cc).all()
        cc_map = {cc.id: cc.nome for cc in cc_list}
        
    resultado = []
    for r in regras:
        resultado.append({
            "id": r.id,
            "centro_custo_id": r.centro_custo_id,
            "centro_custo_nome": cc_map.get(r.centro_custo_id) if r.centro_custo_id else "PADRÃO GLOBAL",
            "data_inicio": str(r.data_inicio),
            "taxa_servico": float(r.taxa_servico),
            "dias_tolerancia_atraso": r.dias_tolerancia_atraso,
            "redutor_atraso_intermediario_pct": float(r.redutor_atraso_intermediario_pct),
            "dias_limite_atraso": r.dias_limite_atraso,
            "faixas_produtos_json": r.faixas_produtos_json
        })
        
    return resultado

@router.post("/regras")
def save_regra(
    data: RegraComissaoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Cadastra ou atualiza uma regra de comissão.
    Se retroativo for True, a vigência data_inicio é definida como o 1º dia do mês atual.
    Caso contrário, vigência é hoje.
    """
    empresa_id = current_user.empresa_id
    hoje = date.today()
    
    if data.retroativo:
        data_inicio = date(hoje.year, hoje.month, 1)
    else:
        data_inicio = hoje
        
    # Verificar se já existe uma regra para a mesma empresa, centro de custo e data de início de vigência
    query = (
        select(RegraComissao)
        .where(
            RegraComissao.empresa_id == empresa_id,
            RegraComissao.centro_custo_id == data.centro_custo_id,
            RegraComissao.data_inicio == data_inicio,
            RegraComissao.is_deleted == False
        )
    )
    regra_existente = db.exec(query).first()
    
    if regra_existente:
        regra_existente.taxa_servico = data.taxa_servico
        regra_existente.dias_tolerancia_atraso = data.dias_tolerancia_atraso
        regra_existente.redutor_atraso_intermediario_pct = data.redutor_atraso_intermediario_pct
        regra_existente.dias_limite_atraso = data.dias_limite_atraso
        regra_existente.faixas_produtos_json = data.faixas_produtos_json
        db.add(regra_existente)
        db.commit()
        db.refresh(regra_existente)
        return {"message": "Regra atualizada com sucesso", "id": regra_existente.id}
    else:
        nova_regra = RegraComissao(
            empresa_id=empresa_id,
            centro_custo_id=data.centro_custo_id,
            data_inicio=data_inicio,
            taxa_servico=data.taxa_servico,
            dias_tolerancia_atraso=data.dias_tolerancia_atraso,
            redutor_atraso_intermediario_pct=data.redutor_atraso_intermediario_pct,
            dias_limite_atraso=data.dias_limite_atraso,
            faixas_produtos_json=data.faixas_produtos_json
        )
        db.add(nova_regra)
        db.commit()
        db.refresh(nova_regra)
        return {"message": "Regra criada com sucesso", "id": nova_regra.id}

@router.delete("/regras/{regra_id}")
def delete_regra(
    regra_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Remove logicamente uma regra de comissão.
    """
    regra = db.get(RegraComissao, regra_id)
    if not regra or regra.is_deleted:
        raise HTTPException(status_code=404, detail="Regra não encontrada")
        
    regra.soft_delete(current_user.id)
    db.add(regra)
    db.commit()
    return {"message": "Regra removida com sucesso"}

@router.get("/metas")
def get_metas(
    mes: int = Query(..., ge=1, le=12),
    ano: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Retorna todos os vendedores ativos da empresa com suas metas para o mês/ano selecionado.
    """
    empresa_id = current_user.empresa_id
    
    # 1. Buscar todos os vendedores ativos da empresa (excluindo consultores e "Loja" legado)
    vendedores = db.exec(
        select(Usuario)
        .where(
            Usuario.empresa_id == empresa_id,
            Usuario.is_active == True,
            Usuario.is_deleted == False,
            Usuario.is_consultor == False,
            Usuario.email != "loja@kyrus_legado.com"
        )
        .order_by(Usuario.nome)
    ).all()
    
    # 2. Buscar as metas do mês/ano
    metas = db.exec(
        select(MetaVendedor)
        .where(
            MetaVendedor.empresa_id == empresa_id,
            MetaVendedor.mes == mes,
            MetaVendedor.ano == ano,
            MetaVendedor.is_deleted == False
        )
    ).all()
    
    metas_map = {m.vendedor_id: m for m in metas}
    
    resultado = []
    for v in vendedores:
        meta_obj = metas_map.get(v.id)
        resultado.append({
            "vendedor_id": v.id,
            "nome": v.nome,
            "email": v.email,
            "valor_meta": float(meta_obj.valor_meta) if meta_obj else 0.0,
            "meta_id": meta_obj.id if meta_obj else None
        })
        
    return resultado

@router.post("/metas")
def save_meta(
    data: MetaVendedorCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Define ou atualiza a meta de faturamento de um vendedor para um determinado mês/ano.
    """
    empresa_id = current_user.empresa_id
    
    query = (
        select(MetaVendedor)
        .where(
            MetaVendedor.empresa_id == empresa_id,
            MetaVendedor.vendedor_id == data.vendedor_id,
            MetaVendedor.mes == data.mes,
            MetaVendedor.ano == data.ano,
            MetaVendedor.is_deleted == False
        )
    )
    meta_existente = db.exec(query).first()
    
    if meta_existente:
        meta_existente.valor_meta = data.valor_meta
        db.add(meta_existente)
        db.commit()
        return {"message": "Meta atualizada com sucesso", "id": meta_existente.id}
    else:
        nova_meta = MetaVendedor(
            empresa_id=empresa_id,
            vendedor_id=data.vendedor_id,
            mes=data.mes,
            ano=data.ano,
            valor_meta=data.valor_meta
        )
        db.add(nova_meta)
        db.commit()
        db.refresh(nova_meta)
        return {"message": "Meta criada com sucesso", "id": nova_meta.id}

class MetaVendedorBatchItem(BaseModel):
    vendedor_id: int
    mes: int
    ano: int
    valor_meta: Decimal

@router.get("/metas/ano/{ano}")
def get_metas_ano(
    ano: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Retorna a matriz de metas de todos os vendedores para os 12 meses do ano selecionado.
    Exclui o usuário chamado "Loja" da lista de vendedores, conforme regra de negócio.
    """
    empresa_id = current_user.empresa_id
    
    # Buscar vendedores ativos da empresa (excluindo consultores e usuário "Loja" por e-mail)
    vendedores = db.exec(
        select(Usuario)
        .where(
            Usuario.empresa_id == empresa_id,
            Usuario.is_active == True,
            Usuario.is_deleted == False,
            Usuario.is_consultor == False,
            Usuario.email != "loja@kyrus_legado.com"
        )
        .order_by(Usuario.nome)
    ).all()
    
    # Buscar metas cadastradas para o ano
    metas = db.exec(
        select(MetaVendedor)
        .where(
            MetaVendedor.empresa_id == empresa_id,
            MetaVendedor.ano == ano,
            MetaVendedor.is_deleted == False
        )
    ).all()
    
    # Agrupar metas por (vendedor_id, mes)
    metas_map = {(m.vendedor_id, m.mes): m.valor_meta for m in metas}
    
    resultado = []
    for v in vendedores:
        meses_lista = []
        for mes in range(1, 13):
            valor = metas_map.get((v.id, mes), Decimal("0.00"))
            meses_lista.append({
                "mes": mes,
                "valor_meta": float(valor)
            })
        resultado.append({
            "vendedor_id": v.id,
            "nome": v.nome,
            "email": v.email,
            "meses": meses_lista
        })
        
    return resultado

@router.post("/metas/batch")
def save_metas_batch(
    data: List[MetaVendedorBatchItem],
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Salva ou atualiza uma lista de metas de vendedores em lote.
    """
    empresa_id = current_user.empresa_id
    
    for item in data:
        # Buscar se já existe meta configurada
        query = (
            select(MetaVendedor)
            .where(
                MetaVendedor.empresa_id == empresa_id,
                MetaVendedor.vendedor_id == item.vendedor_id,
                MetaVendedor.mes == item.mes,
                MetaVendedor.ano == item.ano,
                MetaVendedor.is_deleted == False
            )
        )
        meta_existente = db.exec(query).first()
        
        if meta_existente:
            meta_existente.valor_meta = item.valor_meta
            db.add(meta_existente)
        else:
            nova_meta = MetaVendedor(
                empresa_id=empresa_id,
                vendedor_id=item.vendedor_id,
                mes=item.mes,
                ano=item.ano,
                valor_meta=item.valor_meta
            )
            db.add(nova_meta)
            
    db.commit()
    return {"message": "Metas atualizadas com sucesso"}


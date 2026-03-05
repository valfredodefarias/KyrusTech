# app/api/v1/endpoints/plano_contas.py

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from loguru import logger
from pydantic import BaseModel

from app.db.session import get_db
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.schemas.plano_contas import PlanoContasCreate, PlanoContasRead, PlanoContasUpdate
from app.crud import crud_plano_contas
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()


def _normalizar_tipo_plano(tipo: str) -> str:
    valor = (tipo or "").strip().upper()
    if valor.startswith("R"):
        return "R"
    if valor.startswith("D"):
        return "D"
    return "D"

# --- SCHEMA LOCAL PARA REORDENAÇÃO ---
class ReordenacaoItem(BaseModel):
    id: int
    codigo: str
    conta_pai_id: Optional[int] = None
    tipo: str

# --- ENDPOINTS ---

@router.get("/", response_model=List[PlanoContasRead])
def read_plano_contas(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista todas as categorias do plano de contas da empresa."""
    # Ordena pelo código para garantir a árvore correta na leitura
    contas = db.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == empresa_id)
        .order_by(PlanoContas.codigo)
    ).all()
    return contas

@router.post("/", response_model=PlanoContasRead, status_code=201)
def create_plano_contas(
    *,
    db: Session = Depends(get_db),
    conta_in: PlanoContasCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Cria uma nova categoria no plano de contas."""
    logger.info(f"Empresa {empresa_id} criando categoria: '{conta_in.nome}'")
    conta = crud_plano_contas.create(db=db, obj_in=conta_in, empresa_id=empresa_id)
    logger.success(f"Categoria '{conta.nome}' criada com ID: {conta.id}")
    return conta

@router.post("/reordenar", status_code=200)
def reordenar_plano_contas(
    *,
    db: Session = Depends(get_db),
    itens: List[ReordenacaoItem],
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Recebe a estrutura completa (Drag & Drop) e salva códigos e hierarquia em massa.
    Resolve o bug de 'perder números' ao recarregar.
    """
    try:
        # Prepara IDs para busca rápida
        ids = [item.id for item in itens]
        
        # Busca todas as contas envolvidas
        db_contas = db.exec(
            select(PlanoContas).where(
                PlanoContas.id.in_(ids),
                PlanoContas.empresa_id == empresa_id
            )
        ).all()
        
        # Mapa { ID: ObjetoBanco }
        conta_map = {c.id: c for c in db_contas}
        
        updates = 0
        for item in itens:
            if item.id in conta_map:
                conta_db = conta_map[item.id]
                novo_tipo = _normalizar_tipo_plano(item.tipo)
                
                # Só atualiza se mudou algo (performance)
                if (conta_db.codigo != item.codigo or 
                    conta_db.conta_pai_id != item.conta_pai_id or
                    conta_db.tipo != novo_tipo):
                    tipo_alterado = conta_db.tipo != novo_tipo
                    
                    conta_db.codigo = item.codigo
                    conta_db.conta_pai_id = item.conta_pai_id
                    conta_db.tipo = novo_tipo
                    
                    db.add(conta_db)

                    if tipo_alterado:
                        novo_tipo_lanc = "RECEITA" if novo_tipo == "R" else "DESPESA"
                        lancamentos_categoria = db.exec(
                            select(Lancamento).where(
                                Lancamento.empresa_id == empresa_id,
                                Lancamento.plano_contas_id == conta_db.id
                            )
                        ).all()
                        for lanc in lancamentos_categoria:
                            lanc.tipo = novo_tipo_lanc
                            db.add(lanc)

                    updates += 1
        
        db.commit()
        logger.info(f"Reordenação concluída. {updates} categorias atualizadas.")
        return {"message": "Ordem salva com sucesso"}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Erro ao reordenar: {e}")
        raise HTTPException(status_code=400, detail="Erro ao salvar a nova ordem.")

@router.patch("/{conta_id}", response_model=PlanoContasRead)
def update_plano_contas(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    conta_in: PlanoContasUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Atualiza uma categoria. 
    SEGURANÇA: Bloqueia mudança de CÓDIGO se já existirem lançamentos.
    """
    logger.info(f"Empresa {empresa_id} atualizando categoria ID: {conta_id}")
    
    # 1. Busca a conta existente
    db_obj = crud_plano_contas.get(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")

    # 2. VERIFICAÇÃO DE SEGURANÇA (Se tentar mudar o código)
    if conta_in.codigo is not None and conta_in.codigo != db_obj.codigo:
        # Verifica uso em lançamentos
        uso = db.exec(
            select(func.count(Lancamento.id))
            .where(
                Lancamento.plano_contas_id == conta_id,
                Lancamento.is_deleted == False
            )
        ).one()

        if uso > 0:
            raise HTTPException(
                status_code=400, 
                detail=f"Não é permitido alterar a posição/código desta categoria pois existem {uso} lançamentos vinculados. Apenas o NOME pode ser editado."
            )
    
    # 3. Atualiza
    conta = crud_plano_contas.update(db=db, db_obj=db_obj, obj_in=conta_in)
    logger.success(f"Categoria ID {conta.id} atualizada com sucesso.")
    return conta

@router.delete("/{conta_id}")
def delete_plano_contas(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Remove uma categoria."""
    
    # Verifica se tem filhos
    filhos = db.exec(select(PlanoContas).where(PlanoContas.conta_pai_id == conta_id)).first()
    if filhos:
        raise HTTPException(status_code=400, detail="Não é possível excluir uma categoria que possui subcategorias.")

    # Verifica se tem lançamentos
    uso = db.exec(select(Lancamento).where(Lancamento.plano_contas_id == conta_id)).first()
    if uso:
        raise HTTPException(status_code=400, detail="Não é possível excluir uma categoria que possui lançamentos.")

    db_obj = crud_plano_contas.delete(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    
    logger.success(f"Categoria ID {conta_id} removida com sucesso.")
    return {"ok": True}
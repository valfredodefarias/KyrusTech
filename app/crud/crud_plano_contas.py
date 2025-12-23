# app/crud/crud_plano_contas.py

from typing import List, Optional
from sqlmodel import Session, select
from app.models.plano_contas import PlanoContas
from app.schemas.plano_contas import PlanoContasCreate, PlanoContasUpdate

# --- FUNÇÕES BÁSICAS DE CRUD (Faltavam estas) ---

def get(db: Session, *, id: int, empresa_id: int) -> Optional[PlanoContas]:
    """Busca uma categoria específica pelo ID e Empresa."""
    statement = select(PlanoContas).where(PlanoContas.id == id, PlanoContas.empresa_id == empresa_id)
    return db.exec(statement).first()

def get_by_empresa(db: Session, *, empresa_id: int) -> List[PlanoContas]:
    """Busca todas as categorias da empresa."""
    statement = select(PlanoContas).where(PlanoContas.empresa_id == empresa_id).order_by(PlanoContas.nome)
    return list(db.exec(statement).all())

def create(db: Session, *, obj_in: PlanoContasCreate, empresa_id: int) -> PlanoContas:
    """Cria uma nova categoria manualmente."""
    db_obj = PlanoContas.model_validate(obj_in, update={"empresa_id": empresa_id})
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update(db: Session, *, db_obj: PlanoContas, obj_in: PlanoContasUpdate) -> PlanoContas:
    """Atualiza uma categoria existente."""
    update_data = obj_in.model_dump(exclude_unset=True)
    db_obj.sqlmodel_update(update_data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(db: Session, *, id: int, empresa_id: int) -> Optional[PlanoContas]:
    """Remove uma categoria."""
    db_obj = get(db=db, id=id, empresa_id=empresa_id)
    if db_obj:
        db.delete(db_obj)
        db.commit()
    return db_obj

# --- SUA FUNÇÃO DE SEED (Mantida intacta) ---

def seed_plano_contas_padrao(db: Session, *, empresa_id: int):
    """Cria plano padrão. Lida com listas e dicionários."""
    plano_estrutura = {
        "1. Receitas": {"tipo": "R", "filhas": [
            {"nome": "1.1 Venda de Produtos", "tipo": "R"},
            {"nome": "1.2 Venda de Serviços", "tipo": "R"}
        ]},
        "2. Despesas": {"tipo": "D", "filhas": {
            "2.1 Pessoal": {"tipo": "D", "filhas": [
                {"nome": "2.1.1 Salários", "tipo": "D"}
            ]},
            "2.2 Administrativas": {"tipo": "D", "filhas": [
                {"nome": "2.2.1 Aluguel", "tipo": "D"}
            ]}
        }}
    }

    def criar_recursivo(estrutura, conta_pai_id=None):
        if isinstance(estrutura, list):
            for item in estrutura:
                nc = PlanoContas(
                    nome=item["nome"], tipo=item["tipo"], empresa_id=empresa_id,
                    conta_pai_id=conta_pai_id, permite_lancamentos=True
                )
                db.add(nc)
            return

        if isinstance(estrutura, dict):
            for nome, dados in estrutura.items():
                nc = PlanoContas(
                    nome=nome, tipo=dados["tipo"], empresa_id=empresa_id,
                    conta_pai_id=conta_pai_id, permite_lancamentos='filhas' not in dados
                )
                db.add(nc)
                db.flush()
                if 'filhas' in dados:
                    criar_recursivo(dados['filhas'], nc.id)

    criar_recursivo(plano_estrutura)
    # Commit feito pelo caller (quem chamou a função)
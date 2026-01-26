from typing import Optional
from sqlmodel import SQLModel, Field

# --- BASE ---
class PlanoContasBase(SQLModel):
    nome: str
    tipo: str # 'RECEITA' ou 'DESPESA'
    codigo: Optional[str] = None
    permite_lancamentos: bool = True
    conta_pai_id: Optional[int] = None
    # empresa_id geralmente é injetado pelo backend, mas se seu base precisa, mantenha.

# --- CREATE ---
class PlanoContasCreate(PlanoContasBase):
    pass

# --- READ ---
class PlanoContasRead(PlanoContasBase):
    id: int

# --- UPDATE (CORRIGIDO) ---
class PlanoContasUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    permite_lancamentos: Optional[bool] = None
    
    # Adicionados para corrigir o erro 500 e permitir reordenação:
    codigo: Optional[str] = None       
    conta_pai_id: Optional[int] = None
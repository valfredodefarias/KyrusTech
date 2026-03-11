from typing import Optional
from sqlmodel import SQLModel, Field

# --- BASE ---
class PlanoContasBase(SQLModel):
    nome: str
    tipo: str # 'R' (Receita) ou 'D' (Despesa)
    codigo: Optional[str] = None
    permite_lancamentos: bool = True
    eh_operacional: bool = True
    considerar_nos_resultados: bool = True
    conta_pai_id: Optional[int] = None
    # empresa_id geralmente é injetado pelo backend, mas se seu base precisa, mantenha.

# --- CREATE ---
class PlanoContasCreate(PlanoContasBase):
    pass

# --- READ ---
class PlanoContasRead(PlanoContasBase):
    id: int
    eh_cabecalho: bool = False

# --- UPDATE (CORRIGIDO) ---
class PlanoContasUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    permite_lancamentos: Optional[bool] = None
    eh_operacional: Optional[bool] = None
    considerar_nos_resultados: Optional[bool] = None
    
    # Adicionados para corrigir o erro 500 e permitir reordenação:
    codigo: Optional[str] = None       
    conta_pai_id: Optional[int] = None
# app/schemas/usuario.py
from typing import List, Optional
from sqlmodel import SQLModel
from pydantic import EmailStr
from .base_audit import AuditReadMixin

# --- BASE ---
class UsuarioBase(SQLModel):
    email: str
    is_active: bool = True
    is_consultor: bool = False
    is_superuser: bool = False  # Adicionado pois costuma ser exigido pelo Auth
    nome: Optional[str] = None
    empresa_id: Optional[int] = None
    consultor_role: str = "USUARIO_NORMAL"  # Novo: role do consultor
    foto_url: Optional[str] = None

# --- CREATE ---
# O sistema espera "UserCreate", então usamos esse nome
class UserCreate(UsuarioBase):
    password: str

# --- UPDATE ---
class UserUpdate(SQLModel):
    email: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_consultor: Optional[bool] = None
    nome: Optional[str] = None
    empresa_id: Optional[int] = None
    consultor_role: Optional[str] = None  # Novo: role do consultor
    foto_url: Optional[str] = None

# --- READ ---
class UserRead(UsuarioBase, AuditReadMixin):
    id: int
    permissions: Optional[List[str]] = None

# --- Alias para compatibilidade (Opcional, mas ajuda se tiver código misto) ---
UsuarioCreate = UserCreate
UsuarioUpdate = UserUpdate
UsuarioRead = UserRead

# --- Role Change Request ---
class RoleChangeRequest(SQLModel):
    role: str  # "SUPER_CONSULTOR" ou "CONSULTOR"
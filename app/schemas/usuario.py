from sqlmodel import SQLModel

class UserCreate(SQLModel):
    email: str
    password: str
    empresa_id: int

class UserRead(SQLModel):
    id: int
    email: str
    is_active: bool
    empresa_id: int
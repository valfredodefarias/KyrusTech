from typing import Optional
from sqlmodel import SQLModel

class Token(SQLModel):
    expires_in_minutes: int
from datetime import datetime
from sqlmodel import SQLModel

class Token(SQLModel):
    expires_in_minutes: int
    expires_at: datetime
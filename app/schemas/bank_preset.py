from typing import List, Optional

from sqlmodel import SQLModel


class BankPresetBase(SQLModel):
    label: str
    bank_name: str
    aliases: List[str] = []
    logo_url: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class BankPresetCreate(BankPresetBase):
    key: Optional[str] = None


class BankPresetUpdate(SQLModel):
    label: Optional[str] = None
    bank_name: Optional[str] = None
    aliases: Optional[List[str]] = None
    logo_url: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class BankPresetRead(BankPresetBase):
    key: str
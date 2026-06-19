from __future__ import annotations

# app/schemas/audit_log.py
from datetime import datetime
from typing import Any, List, Optional
from sqlmodel import SQLModel

class AuditLogItem(SQLModel):
    id: int
    table_name: str
    record_id: int
    action: str
    changes: Optional[Any] = None
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    undone: bool = False
    created_at: datetime

class AuditLogList(SQLModel):
    items: List[AuditLogItem]
    total: int

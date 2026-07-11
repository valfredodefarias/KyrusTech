from __future__ import annotations

# app/schemas/audit_log.py
from datetime import datetime
from typing import Any, List, Optional
from sqlmodel import SQLModel

class AuditLogItem(SQLModel):
    id: int
    friendly_table_name: str
    friendly_action: str
    friendly_details: List[str]
    user_email: Optional[str] = None
    undone: bool = False
    is_undoable: bool = False
    batch_id: Optional[str] = None
    created_at: datetime


class AuditLogList(SQLModel):
    items: List[AuditLogItem]
    total: int

# app/api/v1/endpoints/todos.py
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db.session import get_db
from app.api.v1.deps import get_current_active_user, get_empresa_id_from_user
from app.models.todo_item import TodoItem
from app.models.usuario import Usuario
from app.schemas.todo import TodoRead, TodoCreate

router = APIRouter()


def _normalize_date(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day)


def _get_weekday_code(d: datetime) -> str:
    return ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"][d.weekday()]


@router.get("/me", response_model=List[TodoRead])
def listar_todos_me(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    query = select(TodoItem).where(
        TodoItem.is_deleted == False,
        (TodoItem.consultor_id == current_user.id) | (TodoItem.empresa_id == empresa_id)
    )
    return list(db.exec(query).all())


@router.post("/", response_model=TodoRead)
def criar_todo_me(
    todo_in: TodoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if todo_in.tipo_alvo not in ["EMPRESA", "CONSULTOR"]:
        raise HTTPException(status_code=400, detail="tipo_alvo inválido")

    if todo_in.periodicidade not in ["UNICA", "DIARIA", "SEMANAL"]:
        raise HTTPException(status_code=400, detail="periodicidade inválida")

    if todo_in.periodicidade != "UNICA" and not todo_in.end_date:
        raise HTTPException(status_code=400, detail="end_date é obrigatório para tarefas recorrentes")

    if todo_in.periodicidade == "SEMANAL" and not todo_in.dias_semana:
        raise HTTPException(status_code=400, detail="dias_semana é obrigatório para periodicidade SEMANAL")

    if todo_in.end_date and todo_in.due_date and todo_in.end_date < todo_in.due_date:
        raise HTTPException(status_code=400, detail="end_date não pode ser menor que due_date")

    if todo_in.tipo_alvo == "EMPRESA":
        if todo_in.empresa_id and todo_in.empresa_id != empresa_id:
            raise HTTPException(status_code=403, detail="Empresa inválida")
    else:
        if todo_in.consultor_id and todo_in.consultor_id != current_user.id:
            raise HTTPException(status_code=403, detail="Usuário inválido")

    def normalize_date(dt: datetime) -> datetime:
        return datetime(dt.year, dt.month, dt.day)

    occurrences: List[TodoItem] = []
    start = normalize_date(todo_in.due_date) if todo_in.due_date else normalize_date(datetime.now())

    if todo_in.periodicidade == "UNICA":
        todo = TodoItem.model_validate(todo_in)
        todo.status = "PENDENTE"
        todo.empresa_id = empresa_id if todo_in.tipo_alvo == "EMPRESA" else None
        todo.consultor_id = current_user.id if todo_in.tipo_alvo == "CONSULTOR" else None
        todo.created_by_id = current_user.id
        todo.due_date = start
        occurrences.append(todo)
    else:
        end = normalize_date(todo_in.end_date) if todo_in.end_date else start
        dias_semana = []
        if todo_in.dias_semana:
            dias_semana = [d.strip().upper() for d in todo_in.dias_semana.split(',') if d.strip()]
        if todo_in.inclui_sabado and "SAB" not in dias_semana:
            dias_semana.append("SAB")

        current = start
        while current <= end:
            weekday_code = _get_weekday_code(current)
            if todo_in.periodicidade == "DIARIA":
                if not todo_in.inclui_sabado and weekday_code == "SAB":
                    current = current + timedelta(days=1)
                    continue
                todo = TodoItem.model_validate(todo_in)
                todo.status = "PENDENTE"
                todo.empresa_id = empresa_id if todo_in.tipo_alvo == "EMPRESA" else None
                todo.consultor_id = current_user.id if todo_in.tipo_alvo == "CONSULTOR" else None
                todo.created_by_id = current_user.id
                todo.due_date = current
                occurrences.append(todo)
            elif todo_in.periodicidade == "SEMANAL":
                if weekday_code in dias_semana:
                    todo = TodoItem.model_validate(todo_in)
                    todo.status = "PENDENTE"
                    todo.empresa_id = empresa_id if todo_in.tipo_alvo == "EMPRESA" else None
                    todo.consultor_id = current_user.id if todo_in.tipo_alvo == "CONSULTOR" else None
                    todo.created_by_id = current_user.id
                    todo.due_date = current
                    occurrences.append(todo)
            current = current + timedelta(days=1)

    for item in occurrences:
        db.add(item)
    db.commit()

    if len(occurrences) == 1:
        db.refresh(occurrences[0])
        return occurrences[0]

    db.refresh(occurrences[0])
    return occurrences[0]


@router.get("/resumo", response_model=dict)
def resumo_todos_me(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    query = select(TodoItem).where(
        TodoItem.is_deleted == False,
        (TodoItem.consultor_id == current_user.id) | (TodoItem.empresa_id == empresa_id)
    )
    todos = list(db.exec(query).all())

    today = _normalize_date(datetime.now()).date()
    tomorrow = today + timedelta(days=1)
    week_end = today + timedelta(days=7)

    def is_overdue(t: TodoItem) -> bool:
        return bool(t.due_date and t.due_date.date() < today and t.status != "CONCLUIDO")

    def is_completed_late(t: TodoItem) -> bool:
        return bool(
            t.status == "CONCLUIDO"
            and t.due_date
            and t.finished_at
            and t.finished_at.date() > t.due_date.date()
        )

    summary = {
        "amanha": 0,
        "semana": 0,
        "futuras": 0,
        "atrasadas": 0,
        "concluidas_atraso": 0,
    }

    for t in todos:
        if t.is_deleted:
            continue
        if t.due_date:
            due = t.due_date.date()
            if t.status != "CONCLUIDO" and due == tomorrow:
                summary["amanha"] += 1
            if t.status != "CONCLUIDO" and today <= due <= week_end:
                summary["semana"] += 1
            if t.status != "CONCLUIDO" and due > week_end:
                summary["futuras"] += 1
        if is_overdue(t):
            summary["atrasadas"] += 1
        if is_completed_late(t):
            summary["concluidas_atraso"] += 1

    return summary


@router.post("/{todo_id}/iniciar", response_model=TodoRead)
def iniciar_todo_me(
    todo_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    todo = db.get(TodoItem, todo_id)
    if not todo or todo.is_deleted:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    if not (todo.consultor_id == current_user.id or todo.empresa_id == empresa_id):
        raise HTTPException(status_code=403, detail="Sem acesso à tarefa")

    todo.last_started_at = datetime.utcnow()
    todo.status = "EM_ANDAMENTO"
    todo.updated_by_id = current_user.id
    db.add(todo)
    db.commit()
    db.refresh(todo)

    return todo


@router.post("/{todo_id}/finalizar", response_model=TodoRead)
def finalizar_todo_me(
    todo_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    todo = db.get(TodoItem, todo_id)
    if not todo or todo.is_deleted:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    if not (todo.consultor_id == current_user.id or todo.empresa_id == empresa_id):
        raise HTTPException(status_code=403, detail="Sem acesso à tarefa")

    now = datetime.utcnow()
    if todo.last_started_at:
        delta = now - todo.last_started_at
        todo.total_seconds = max(0, todo.total_seconds + int(delta.total_seconds()))

    todo.finished_at = now
    todo.status = "CONCLUIDO"
    todo.updated_by_id = current_user.id
    db.add(todo)
    db.commit()
    db.refresh(todo)

    return todo

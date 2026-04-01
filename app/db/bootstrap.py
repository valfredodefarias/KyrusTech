from __future__ import annotations

from sqlalchemy import BigInteger, Integer, MetaData, SmallInteger, Table, create_engine, func, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import NoSuchTableError
from sqlmodel import SQLModel

from app import models  # noqa: F401  # Garante registro de todos os modelos no metadata
from app.core.config import settings

BOOTSTRAP_STATE_TABLE = "app_bootstrap_state"
BOOTSTRAP_STATE_KEY = "legacy_database_imported"


def _build_engine(database_url: str) -> Engine:
    return create_engine(database_url, pool_pre_ping=True, echo=False)


def _ensure_state_table(target_engine: Engine) -> None:
    statement = f"""
    CREATE TABLE IF NOT EXISTS {BOOTSTRAP_STATE_TABLE} (
        name VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )
    """

    with target_engine.begin() as connection:
        connection.execute(text(statement))


def _bootstrap_completed(target_engine: Engine) -> bool:
    inspector = inspect(target_engine)
    if not inspector.has_table(BOOTSTRAP_STATE_TABLE):
        return False

    with target_engine.connect() as connection:
        value = connection.execute(
            text(f"SELECT value FROM {BOOTSTRAP_STATE_TABLE} WHERE name = :name"),
            {"name": BOOTSTRAP_STATE_KEY},
        ).scalar_one_or_none()

    return value == "done"


def _target_database_has_data(target_engine: Engine) -> bool:
    inspector = inspect(target_engine)
    managed_table_names = set(SQLModel.metadata.tables.keys())
    table_names = [table_name for table_name in inspector.get_table_names() if table_name in managed_table_names]

    with target_engine.connect() as connection:
        for table_name in table_names:
            count_value = connection.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()
            if count_value:
                return True

    return False


def _drop_unmanaged_tables(target_engine: Engine) -> int:
    inspector = inspect(target_engine)
    managed_table_names = set(SQLModel.metadata.tables.keys()) | {BOOTSTRAP_STATE_TABLE, "alembic_version"}
    tables_to_drop = [table_name for table_name in inspector.get_table_names() if table_name not in managed_table_names]

    if not tables_to_drop:
        return 0

    with target_engine.begin() as connection:
        for table_name in tables_to_drop:
            connection.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))

    return len(tables_to_drop)


def _copy_table(source_engine: Engine, target_engine: Engine, table: Table) -> int:
    source_metadata = MetaData()
    target_metadata = MetaData()

    try:
        source_table = Table(table.name, source_metadata, autoload_with=source_engine)
    except NoSuchTableError:
        return 0

    target_table = Table(table.name, target_metadata, autoload_with=target_engine)
    source_column_names = set(source_table.columns.keys())
    common_columns = [column.name for column in target_table.columns if column.name in source_column_names]

    if not common_columns:
        return 0

    with source_engine.connect() as source_connection:
        rows = source_connection.execute(
            select(*[source_table.c[column_name] for column_name in common_columns])
        ).mappings().all()

    if not rows:
        return 0

    payload = [{column_name: row[column_name] for column_name in common_columns} for row in rows]

    with target_engine.begin() as target_connection:
        target_connection.execute(target_table.insert(), payload)

    return len(payload)


def _reset_integer_sequences(target_engine: Engine) -> None:
    with target_engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            if table.name == BOOTSTRAP_STATE_TABLE:
                continue

            primary_key_columns = [column for column in table.primary_key.columns if column.primary_key]
            if len(primary_key_columns) != 1:
                continue

            primary_key_column = primary_key_columns[0]
            if not isinstance(primary_key_column.type, (Integer, BigInteger, SmallInteger)):
                continue

            sequence_name = connection.execute(
                text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                {"table_name": table.name, "column_name": primary_key_column.name},
            ).scalar_one_or_none()

            if not sequence_name:
                continue

            max_value = connection.execute(
                select(func.coalesce(func.max(table.c[primary_key_column.name]), 0)).select_from(table)
            ).scalar_one()

            if max_value and int(max_value) > 0:
                connection.execute(
                    text("SELECT setval(:sequence_name, :sequence_value, true)"),
                    {"sequence_name": sequence_name, "sequence_value": int(max_value)},
                )
            else:
                connection.execute(
                    text("SELECT setval(:sequence_name, 1, false)"),
                    {"sequence_name": sequence_name},
                )


def _mark_bootstrap_completed(target_engine: Engine) -> None:
    with target_engine.begin() as connection:
        connection.execute(
            text(
                f"""
                INSERT INTO {BOOTSTRAP_STATE_TABLE} (name, value, updated_at)
                VALUES (:name, :value, NOW())
                ON CONFLICT (name)
                DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                """
            ),
            {"name": BOOTSTRAP_STATE_KEY, "value": "done"},
        )


def should_auto_bootstrap_legacy_database() -> bool:
    if (settings.ENVIRONMENT or "").strip().lower() != "production":
        return False

    if not settings.LEGACY_DATABASE_URL:
        return False

    target_engine = _build_engine(settings.DATABASE_URL)
    if _bootstrap_completed(target_engine):
        return False

    if _target_database_has_data(target_engine):
        return False

    return True


def bootstrap_legacy_database() -> int:
    """Cria o schema do banco novo e copia os dados do banco legado, quando configurado."""
    target_engine = _build_engine(settings.DATABASE_URL)

    if settings.DROP_UNUSED_TABLES:
        dropped_tables = _drop_unmanaged_tables(target_engine)
        if dropped_tables:
            print(f"🧹 Tabelas órfãs removidas do banco de destino: {dropped_tables}")

    SQLModel.metadata.create_all(target_engine)
    _ensure_state_table(target_engine)

    if _bootstrap_completed(target_engine):
        return 0

    if _target_database_has_data(target_engine):
        raise RuntimeError(
            "O banco de destino já possui dados. Limpe o banco novo antes de executar a cópia do legado."
        )

    if not settings.LEGACY_DATABASE_URL:
        raise RuntimeError(
            "LEGACY_DATABASE_URL não configurada. Defina LEGACY_POSTGRES_* para copiar os dados antigos."
        )

    source_engine = _build_engine(settings.LEGACY_DATABASE_URL)
    copied_rows = 0

    for table in SQLModel.metadata.sorted_tables:
        if table.name in {BOOTSTRAP_STATE_TABLE, "alembic_version"}:
            continue
        copied_rows += _copy_table(source_engine, target_engine, table)

    _reset_integer_sequences(target_engine)
    _mark_bootstrap_completed(target_engine)

    return copied_rows

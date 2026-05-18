"""Add import jobs table"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c2a1e3f7d9b0"
down_revision: Union[str, tuple[str, str, str]] = ("b7c9e8d1a2f3", "f1c2d3e4a5b6", "merge_20260126")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        sa.Column("job_id", sa.String(), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("empresa_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="PENDING"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("message", sa.String(), nullable=False, server_default="Aguardando processamento"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_import_jobs_job_id"), "import_jobs", ["job_id"], unique=False)
    op.create_index(op.f("ix_import_jobs_empresa_id"), "import_jobs", ["empresa_id"], unique=False)
    op.create_index(op.f("ix_import_jobs_user_id"), "import_jobs", ["user_id"], unique=False)
    op.create_index(op.f("ix_import_jobs_kind"), "import_jobs", ["kind"], unique=False)
    op.create_index(op.f("ix_import_jobs_status"), "import_jobs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_import_jobs_status"), table_name="import_jobs")
    op.drop_index(op.f("ix_import_jobs_kind"), table_name="import_jobs")
    op.drop_index(op.f("ix_import_jobs_user_id"), table_name="import_jobs")
    op.drop_index(op.f("ix_import_jobs_empresa_id"), table_name="import_jobs")
    op.drop_index(op.f("ix_import_jobs_job_id"), table_name="import_jobs")
    op.drop_table("import_jobs")

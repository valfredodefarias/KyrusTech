"""add_nfe_permissions_rbac"""

from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4a72b9e1d3f4"
down_revision: Union[str, None] = "9f3a1c2b7d11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PERMISSIONS = [
    {
        "code": "page:importacao_nfe:view",
        "module": "importacao_nfe",
        "action": "view",
        "description": "Acesso a pagina de Importacao XML NF-e",
        "is_page_level": True,
    },
    {
        "code": "lancamentos:import_nfe",
        "module": "lancamentos",
        "action": "import_nfe",
        "description": "Importar lancamentos via XML NF-e",
        "is_page_level": False,
    },
]


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.utcnow()

    for row in PERMISSIONS:
        bind.execute(
            sa.text(
                """
                INSERT INTO access_permissions
                    (created_at, updated_at, created_by_id, updated_by_id, is_deleted, deleted_at, deleted_by_id,
                     code, module, action, description, is_page_level, is_active)
                VALUES
                    (:created_at, :updated_at, NULL, NULL, false, NULL, NULL,
                     :code, :module, :action, :description, :is_page_level, true)
                ON CONFLICT (code)
                DO UPDATE SET
                    updated_at = EXCLUDED.updated_at,
                    module = EXCLUDED.module,
                    action = EXCLUDED.action,
                    description = EXCLUDED.description,
                    is_page_level = EXCLUDED.is_page_level,
                    is_active = true,
                    is_deleted = false
                """
            ),
            {
                "created_at": now,
                "updated_at": now,
                "code": row["code"],
                "module": row["module"],
                "action": row["action"],
                "description": row["description"],
                "is_page_level": row["is_page_level"],
            },
        )

    permission_map = {
        item.code: item.id
        for item in bind.execute(
            sa.text(
                """
                SELECT id, code
                FROM access_permissions
                WHERE code IN ('page:importacao_nfe:view', 'lancamentos:import_nfe')
                  AND is_deleted = false
                """
            )
        ).fetchall()
    }

    profile_rows = bind.execute(
        sa.text(
            """
            SELECT id
            FROM access_profiles
            WHERE is_deleted = false
              AND (
                code IN ('TEMPLATE_FULL_ACCESS', 'TEMPLATE_FINANCEIRO', 'FULL_ACCESS')
                OR base_template_code = 'TEMPLATE_FULL_ACCESS'
              )
            """
        )
    ).fetchall()

    for profile_row in profile_rows:
        profile_id = int(profile_row.id)
        for permission_code in permission_map:
            permission_id = int(permission_map[permission_code])
            bind.execute(
                sa.text(
                    """
                    INSERT INTO access_profile_permissions
                        (created_at, updated_at, created_by_id, updated_by_id, is_deleted, deleted_at, deleted_by_id,
                         profile_id, permission_id, allowed)
                    VALUES
                        (:created_at, :updated_at, NULL, NULL, false, NULL, NULL,
                         :profile_id, :permission_id, true)
                    ON CONFLICT (profile_id, permission_id)
                    DO UPDATE SET
                        updated_at = EXCLUDED.updated_at,
                        allowed = true,
                        is_deleted = false
                    """
                ),
                {
                    "created_at": now,
                    "updated_at": now,
                    "profile_id": profile_id,
                    "permission_id": permission_id,
                },
            )


def downgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            DELETE FROM access_profile_permissions
            WHERE permission_id IN (
                SELECT id
                FROM access_permissions
                WHERE code IN ('page:importacao_nfe:view', 'lancamentos:import_nfe')
            )
            """
        )
    )

    bind.execute(
        sa.text(
            """
            DELETE FROM access_permissions
            WHERE code IN ('page:importacao_nfe:view', 'lancamentos:import_nfe')
            """
        )
    )

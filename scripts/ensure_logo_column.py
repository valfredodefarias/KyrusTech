import psycopg2
from app.core.config import settings

conn = psycopg2.connect(
    host=settings.POSTGRES_SERVER,
    port=settings.POSTGRES_PORT,
    user=settings.POSTGRES_USER,
    password=settings.POSTGRES_PASSWORD,
    dbname=settings.POSTGRES_DB,
)
cur = conn.cursor()
cur.execute(
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'contas' AND column_name = 'logo_url'
        ) THEN
            ALTER TABLE contas ADD COLUMN logo_url VARCHAR;
        END IF;
    END$$;
    """
)
conn.commit()
cur.close()
conn.close()
print("logo_url column ensured")

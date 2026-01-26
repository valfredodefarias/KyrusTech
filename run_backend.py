import asyncio
import sys
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from sqlmodel import SQLModel

from app.core.config import settings
from app.db.session import engine

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))


async def init_db() -> None:
    try:
        SQLModel.metadata.create_all(engine)
        print("✅ Banco de dados inicializado com sucesso")
    except Exception as exc:
        print(f"⚠️  Erro ao inicializar banco: {exc}")


if __name__ == "__main__":
    print("\n" + "=" * 80)
    print("🚀 KyrusTech - Backend")
    print("=" * 80)
    print(f"📦 Ambiente: {settings.ENVIRONMENT}")
    print(f"🗄️  Banco: {settings.POSTGRES_SERVER}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}")
    print(f"🔐 CORS: {settings.BACKEND_CORS_ORIGINS}")
    print("=" * 80)

    asyncio.run(init_db())

    reload = settings.ENVIRONMENT == "development"
    log_level = "debug" if reload else "info"

    print(f"\n💡 API: http://0.0.0.0:8000")
    print(f"📄 Docs: http://0.0.0.0:8000/docs")
    print(f"⚙️  Hot Reload: {'ATIVADO' if reload else 'DESATIVADO'}")
    print("=" * 80 + "\n")

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=reload,
        log_level=log_level,
    )

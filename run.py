import asyncio
import os
import shutil
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlmodel import SQLModel

from app.core.config import settings
from app.db.session import engine

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT_DIR / "kyrus-web"

BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
FRONTEND_HOST = os.getenv("FRONTEND_HOST", "0.0.0.0")
FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", "5173"))
RELOAD_BACKEND = settings.ENVIRONMENT == "development"
BACKEND_LOG_LEVEL = "debug" if RELOAD_BACKEND else "info"


async def init_db() -> None:
    try:
        SQLModel.metadata.create_all(engine)
        print("Banco de dados inicializado com sucesso")
    except Exception as exc:
        print(f"Erro ao inicializar banco: {exc}")


def _npm_binary() -> str:
    candidate = "npm.cmd" if os.name == "nt" else "npm"
    npm_path = shutil.which(candidate)
    if not npm_path:
        raise RuntimeError("npm não encontrado no PATH. Instale o Node.js ou ajuste as variáveis de ambiente.")
    return npm_path


def _pythonpath_env(env: dict[str, str]) -> dict[str, str]:
    current = env.get("PYTHONPATH")
    root = str(ROOT_DIR)
    if current:
        if root not in current.split(os.pathsep):
            env["PYTHONPATH"] = os.pathsep.join([root, current])
    else:
        env["PYTHONPATH"] = root
    return env


async def start_backend_process() -> asyncio.subprocess.Process:
    env = _pythonpath_env(os.environ.copy())
    args = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        BACKEND_HOST,
        "--port",
        str(BACKEND_PORT),
        "--log-level",
        BACKEND_LOG_LEVEL,
    ]
    if RELOAD_BACKEND:
        args.append("--reload")
    return await asyncio.create_subprocess_exec(*args, cwd=str(ROOT_DIR), env=env)


async def start_frontend_process() -> asyncio.subprocess.Process:
    if not FRONTEND_DIR.exists():
        raise FileNotFoundError(f"Diretório do frontend não encontrado em {FRONTEND_DIR}")
    npm_cmd = _npm_binary()
    args = [
        npm_cmd,
        "run",
        "dev",
        "--",
        "--host",
        FRONTEND_HOST,
        "--port",
        str(FRONTEND_PORT),
    ]
    return await asyncio.create_subprocess_exec(*args, cwd=str(FRONTEND_DIR))


async def wait_process(tag: str, proc: asyncio.subprocess.Process) -> tuple[str, int]:
    return tag, await proc.wait()


async def graceful_stop(proc: asyncio.subprocess.Process | None, tag: str) -> None:
    if not proc or proc.returncode is not None:
        return
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=10)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
    print(f"⏹️  {tag} encerrado")


async def supervise_processes(
    backend_proc: asyncio.subprocess.Process,
    frontend_proc: asyncio.subprocess.Process,
) -> tuple[str, int]:
    tasks = [
        asyncio.create_task(wait_process("Backend", backend_proc)),
        asyncio.create_task(wait_process("Frontend", frontend_proc)),
    ]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    return next(iter(done)).result()


async def main() -> None:
    print("\n" + "=" * 80)
    print("KyrusTech - Orquestrador Full Stack")
    print("=" * 80)
    print(f"Ambiente: {settings.ENVIRONMENT}")
    print(f"Banco: {settings.POSTGRES_SERVER}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}")
    print(f"Backend: http://{BACKEND_HOST}:{BACKEND_PORT}")
    print(f"Frontend: http://{FRONTEND_HOST}:{FRONTEND_PORT}")
    print("=" * 80)

    try:
        await init_db()
    except Exception as e:
        print(f"Database init skipped: {e}")

    backend_proc = None
    frontend_proc = None
    try:
        backend_proc = await start_backend_process()
        frontend_proc = await start_frontend_process()
        print("⚙️  Serviços iniciados. Pressione CTRL+C para encerrar.")
        tag, code = await supervise_processes(backend_proc, frontend_proc)
        print(f"⚠️  {tag} finalizou com código {code}. Encerrando serviços.")
    finally:
        await graceful_stop(frontend_proc, "Frontend")
        await graceful_stop(backend_proc, "Backend")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Execução interrompida pelo usuário")

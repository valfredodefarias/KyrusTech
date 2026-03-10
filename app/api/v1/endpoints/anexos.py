import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from app.api.v1.deps import get_current_active_user # <--- O GUARDIÃO DA SEGURANÇA

router = APIRouter()

# Define onde salvar (cria a pasta se não existir)
UPLOAD_DIR = Path("static/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_UPLOAD_SIZE = 2 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

@router.post("/upload", response_model=dict)
async def upload_arquivo(
    file: UploadFile = File(...),
    # SEGURANÇA 1: Só permite upload se tiver TOKEN VÁLIDO de usuário logado
    current_user = Depends(get_current_active_user) 
):
    """
    Recebe um arquivo, valida se é imagem, salva com nome único e retorna a URL.
    Requer autenticação.
    """
    
    # SEGURANÇA 2 (Correção Pylance): Valida se o content_type existe E se é imagem
    if not file.content_type or file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, detail="Apenas imagens JPG, PNG, WEBP ou GIF são permitidas.")

    extensao = Path(file.filename or "arquivo").suffix.lower()
    if not extensao or extensao not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(400, detail="Extensão de arquivo inválida para imagem.")

    # SEGURANÇA 3: Renomeia o arquivo com UUID.
    # Isso evita que arquivos com nomes maliciosos (ex: virus.exe) sejam salvos com o nome original.
    novo_nome = f"{uuid.uuid4()}{extensao}"
    caminho_arquivo = UPLOAD_DIR / novo_nome

    # Salva o arquivo no disco
    try:
        bytes_written = 0
        with caminho_arquivo.open("wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_IMAGE_UPLOAD_SIZE:
                    buffer.close()
                    caminho_arquivo.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
                buffer.write(chunk)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(500, detail=f"Erro ao salvar arquivo: {str(e)}")

    # Retorna a URL relativa para salvar no banco
    url_relativa = f"/static/uploads/{novo_nome}"
    
    return {"url": url_relativa}
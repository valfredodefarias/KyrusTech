import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from app.api.v1.deps import get_current_active_user, get_empresa_id_from_user
from app.models.usuario import Usuario
from app.core.upload_security import (
    IMAGE_ALLOWED_EXT_TO_MIME,
    UploadValidationError,
    register_upload_rejection,
    register_upload_success,
    write_validated_upload_file,
)

router = APIRouter()

# Define onde salvar (cria a pasta se não existir)
UPLOAD_DIR = Path("static/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_UPLOAD_SIZE = 2 * 1024 * 1024

@router.post("/upload", response_model=dict)
def upload_arquivo(
    file: UploadFile = File(...),
    request: Request = None,
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Recebe um arquivo, valida se é imagem, salva com nome único e retorna a URL.
    Requer autenticação.
    """
    
    from app.core.network import get_client_ip
    origin = get_client_ip(request)

    extensao = Path(file.filename or "arquivo").suffix.lower()
    if not extensao or extensao not in IMAGE_ALLOWED_EXT_TO_MIME:
        register_upload_rejection(
            endpoint="/api/v1/anexos/upload",
            empresa_id=empresa_id,
            user_id=getattr(current_user, "id", None),
            origin=origin,
            reason="extensao_nao_permitida",
            filename=Path(file.filename or "").name or None,
        )
        raise HTTPException(400, detail="Apenas imagens JPG, PNG, WEBP ou GIF são permitidas.")

    # SEGURANÇA 3: Renomeia o arquivo com UUID.
    # Isso evita que arquivos com nomes maliciosos (ex: virus.exe) sejam salvos com o nome original.
    novo_nome = f"{uuid.uuid4()}{extensao}"
    caminho_arquivo = UPLOAD_DIR / novo_nome

    try:
        _, bytes_written, _ = write_validated_upload_file(
            upload=file,
            destination=caminho_arquivo,
            max_size=MAX_IMAGE_UPLOAD_SIZE,
            allowed_ext_to_mime=IMAGE_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        register_upload_rejection(
            endpoint="/api/v1/anexos/upload",
            empresa_id=empresa_id,
            user_id=getattr(current_user, "id", None),
            origin=origin,
            reason=str(exc.message),
            filename=Path(file.filename or "").name or None,
        )
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    register_upload_success(
        endpoint="/api/v1/anexos/upload",
        empresa_id=empresa_id,
        user_id=getattr(current_user, "id", None),
        origin=origin,
        bytes_written=bytes_written,
    )

    # Retorna a URL relativa para salvar no banco
    url_relativa = f"/static/uploads/{novo_nome}"
    
    return {"url": url_relativa}
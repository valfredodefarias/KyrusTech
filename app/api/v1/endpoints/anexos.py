import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from app.api.v1.deps import get_current_active_user # <--- O GUARDIÃO DA SEGURANÇA

router = APIRouter()

# Define onde salvar (cria a pasta se não existir)
UPLOAD_DIR = Path("static/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, detail="Apenas arquivos de imagem são permitidos.")

    # SEGURANÇA 3: Renomeia o arquivo com UUID.
    # Isso evita que arquivos com nomes maliciosos (ex: virus.exe) sejam salvos com o nome original.
    try:
        extensao = file.filename.split(".")[-1] if file.filename else "png"
    except IndexError:
        extensao = "png"
        
    novo_nome = f"{uuid.uuid4()}.{extensao}"
    caminho_arquivo = UPLOAD_DIR / novo_nome

    # Salva o arquivo no disco
    try:
        with caminho_arquivo.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(500, detail=f"Erro ao salvar arquivo: {str(e)}")

    # Retorna a URL relativa para salvar no banco
    url_relativa = f"/static/uploads/{novo_nome}"
    
    return {"url": url_relativa}
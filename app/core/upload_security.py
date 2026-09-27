from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Iterable
import logging

logger = logging.getLogger(__name__)


class UploadValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.detail = message
        self.status_code = status_code

IMAGE_ALLOWED_EXT_TO_MIME: dict[str, set[str]] = {
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".gif": {"image/gif"},
}

ANEXO_ALLOWED_EXT_TO_MIME: dict[str, set[str]] = {
    ".pdf": {"application/pdf"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".xls": {"application/vnd.ms-excel"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".ppt": {"application/vnd.ms-powerpoint"},
    ".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
}

_WINDOW_REJECTION_SECONDS = 300
_WINDOW_UPLOAD_SECONDS = 60
_REJECTION_THRESHOLD = 5
_UPLOAD_THRESHOLD = 30

_incident_lock = threading.Lock()
_rejection_events: dict[str, deque[float]] = defaultdict(deque)
_upload_events: dict[str, deque[float]] = defaultdict(deque)


def _register_window_event(
    events_map: dict[str, deque[float]],
    *,
    key: str,
    now: float,
    window_seconds: int,
) -> int:
    bucket = events_map[key]
    bucket.append(now)
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    return len(bucket)


def register_upload_rejection(
    *,
    endpoint: str,
    empresa_id: int | None,
    user_id: int | None,
    origin: str,
    reason: str,
    filename: str | None = None,
) -> None:
    now = time.time()
    key = f"{endpoint}|{origin}"
    with _incident_lock:
        total = _register_window_event(
            _rejection_events,
            key=key,
            now=now,
            window_seconds=_WINDOW_REJECTION_SECONDS,
        )

    logger.warning(
        "[UPLOAD_REJECTION] endpoint=%s empresa_id=%s user_id=%s origin=%s reason=%s filename=%s rejections_window=%s window_s=%s",
        endpoint,
        empresa_id,
        user_id,
        origin,
        reason,
        filename or "-",
        total,
        _WINDOW_REJECTION_SECONDS,
    )

    if total >= _REJECTION_THRESHOLD:
        logger.error(
            "[INCIDENT_TRIGGER_15_1] Rejeicoes repetidas detectadas endpoint=%s origin=%s total=%s window_s=%s",
            endpoint,
            origin,
            total,
            _WINDOW_REJECTION_SECONDS,
        )


def register_upload_success(
    *,
    endpoint: str,
    empresa_id: int | None,
    user_id: int | None,
    origin: str,
    bytes_written: int,
) -> None:
    now = time.time()
    key = f"{endpoint}|{origin}"
    with _incident_lock:
        total = _register_window_event(
            _upload_events,
            key=key,
            now=now,
            window_seconds=_WINDOW_UPLOAD_SECONDS,
        )

    if total >= _UPLOAD_THRESHOLD:
        logger.error(
            "[INCIDENT_TRIGGER_15_1] Volume anomalo de uploads endpoint=%s empresa_id=%s user_id=%s origin=%s uploads_window=%s window_s=%s last_bytes=%s",
            endpoint,
            empresa_id,
            user_id,
            origin,
            total,
            _WINDOW_UPLOAD_SECONDS,
            bytes_written,
        )


def sanitize_upload_filename(filename: str | None, *, max_len: int = 180) -> str:
    safe = Path(filename or "").name.strip()
    if not safe:
        raise UploadValidationError("Arquivo inválido: nome ausente.", status_code=400)
    if len(safe) > max_len:
        raise UploadValidationError("Nome do arquivo excede o limite permitido.", status_code=400)
    return safe


def is_content_type_allowed(content_type: str | None, allowed_mimes: Iterable[str]) -> bool:
    if not content_type:
        return True
    normalized = str(content_type).split(";", 1)[0].strip().lower()
    return normalized in {mime.lower() for mime in allowed_mimes}


def signature_matches_extension(ext: str, header: bytes) -> bool:
    ext = ext.lower()

    if ext in {".jpg", ".jpeg"}:
        return len(header) >= 3 and header[:3] == b"\xff\xd8\xff"
    if ext == ".png":
        return len(header) >= 8 and header[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == ".gif":
        return len(header) >= 6 and (header[:6] == b"GIF87a" or header[:6] == b"GIF89a")
    if ext == ".webp":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    if ext == ".pdf":
        return len(header) >= 5 and header[:5] == b"%PDF-"
    if ext in {".xlsx", ".pptx"}:
        return len(header) >= 4 and header[:4] == b"PK\x03\x04"
    if ext in {".xls", ".ppt"}:
        return len(header) >= 8 and header[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

    return False


def write_validated_upload_file(
    *,
    upload: Any,
    destination: Path,
    max_size: int,
    allowed_ext_to_mime: dict[str, set[str]],
    max_filename_len: int = 180,
) -> tuple[str, int, str | None]:
    original_name = sanitize_upload_filename(upload.filename, max_len=max_filename_len)
    ext = Path(original_name).suffix.lower()
    if not ext or ext not in allowed_ext_to_mime:
        raise UploadValidationError("Tipo de arquivo não permitido.", status_code=400)

    content_type = (upload.content_type or "").split(";", 1)[0].strip().lower() or None
    if not is_content_type_allowed(content_type, allowed_ext_to_mime[ext]):
        raise UploadValidationError("Content-Type incompatível com a extensão do arquivo.", status_code=400)

    destination.parent.mkdir(parents=True, exist_ok=True)

    bytes_written = 0
    header = bytearray()
    try:
        with destination.open("wb") as buffer:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > max_size:
                    buffer.close()
                    destination.unlink(missing_ok=True)
                    raise UploadValidationError("Arquivo muito grande.", status_code=413)
                if len(header) < 32:
                    header.extend(chunk[: 32 - len(header)])
                buffer.write(chunk)
    except UploadValidationError:
        raise
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise UploadValidationError(f"Erro ao salvar arquivo: {exc}", status_code=500)

    if bytes_written <= 0:
        destination.unlink(missing_ok=True)
        raise UploadValidationError("Arquivo vazio não é permitido.", status_code=400)

    if not signature_matches_extension(ext, bytes(header)):
        destination.unlink(missing_ok=True)
        raise UploadValidationError("Assinatura do arquivo inválida para a extensão enviada.", status_code=400)

    if not destination.exists() or destination.stat().st_size <= 0:
        destination.unlink(missing_ok=True)
        raise UploadValidationError("Falha ao persistir arquivo no storage local.", status_code=500)

    return original_name, bytes_written, content_type


def safe_local_path_from_static_url(url: str, *, required_prefix: str) -> Path | None:
    normalized_url = str(url or "").strip()
    if not normalized_url.startswith(required_prefix):
        return None

    candidate = Path(normalized_url.lstrip("/")).resolve()
    static_root = Path("static").resolve()

    try:
        candidate.relative_to(static_root)
    except Exception:
        return None

    return candidate

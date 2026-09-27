import shutil
import os
from uuid import uuid4
from typing import Any, List
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy import delete
from sqlmodel import Session, select
from loguru import logger

from app.db.session import get_db
from app.crud.crud_empresa import create_empresa, get_empresa, update_empresa
from app.crud.crud_plano_contas import ensure_transfer_category, get_template_items
from app.schemas.empresa import EmpresaCreate, EmpresaRead, EmpresaUpdate
from app.models.anexo_lancamento import AnexoLancamento
from app.models.cartao import Cartao
from app.models.centro_custo import CentroCusto
from app.core.upload_security import IMAGE_ALLOWED_EXT_TO_MIME, UploadValidationError, write_validated_upload_file
from app.models.conta import Conta
from app.models.empresa import Empresa
from app.models.entidade import Entidade
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.lancamento import Lancamento
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.models.plano_contas import PlanoContas
from app.api.v1.deps import get_current_active_user, get_consultor_user, get_super_consultor_user, require_permission 
from app.crud.crud_consultor_empresa import tem_acesso
from app.enums import ConsultorRole


router = APIRouter()


def _is_super_consultor(current_user) -> bool:
    return bool(current_user.is_consultor and current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value)


def _ensure_empresa_access(current_user, db: Session, empresa_id: int) -> None:
    if current_user.is_consultor:
        if _is_super_consultor(current_user):
            return
        if tem_acesso(db, int(current_user.id), empresa_id):
            return
        raise HTTPException(status_code=403, detail="Você não tem permissão para acessar esta empresa.")

    if current_user.empresa_id != empresa_id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para acessar esta empresa.")


def _seed_company_chart_of_accounts(db: Session, *, empresa_id: int, tipo_pessoa: str) -> None:
    template_items = get_template_items(db=db, tipo_pessoa=tipo_pessoa)
    created_ids: dict[int, int] = {}

    for item in sorted(template_items, key=lambda current: ((current.get("codigo") or "zzz"), current.get("nome") or "")):
        template_id = int(item["id"])
        parent_template_id = item.get("conta_pai_id")
        payload: dict[str, Any] = {
            "nome": str(item.get("nome") or "").strip(),
            "tipo": str(item.get("tipo") or "D").strip().upper()[:1] or "D",
            "codigo": item.get("codigo"),
            "empresa_id": empresa_id,
            "conta_pai_id": created_ids.get(int(parent_template_id)) if parent_template_id is not None else None,
            "permite_lancamentos": bool(item.get("permite_lancamentos", True)),
            "eh_operacional": bool(item.get("eh_operacional", True)),
            "considerar_nos_resultados": bool(item.get("considerar_nos_resultados", True)),
            "oculta": bool(item.get("oculta", False)),
            "eh_cabecalho": bool(item.get("eh_cabecalho", False)),
            "eh_divida": bool(item.get("eh_divida", False)),
        }
        conta = PlanoContas(**payload)
        db.add(conta)
        db.flush()
        if conta.id is None:
            raise ValueError("Falha ao recriar o plano de contas da empresa")
        created_ids[template_id] = int(conta.id)

    ensure_transfer_category(db=db, empresa_id=empresa_id)


def _hard_reset_company_financial_data(db: Session, *, empresa: Empresa) -> dict[str, int]:
    empresa_id = int(empresa.id or 0)
    if not empresa_id:
        raise ValueError("Empresa inválida para reset")

    from app.models.baixa import Baixa
    from app.models.movimento import Movimento
    from app.models.lote_cartao_item import LoteCartaoItem
    from app.models.lote_cartao import LoteCartao
    from app.models.regra_cartao import RegraCartao
    from app.models.lancamento_cartao import LancamentoCartao
    from app.models.usuario_conta_acesso import UsuarioContaAcesso
    from app.models.pdv_movimentacao import PdvMovimentacao

    conta_ids = db.exec(select(Conta.id).where(Conta.empresa_id == empresa_id)).all()
    if conta_ids:
        db.execute(delete(UsuarioContaAcesso).where(getattr(UsuarioContaAcesso, "__table__").c.conta_id.in_(conta_ids)))

    lote_ids = db.exec(select(LoteCartao.id).where(LoteCartao.empresa_id == empresa_id)).all()
    if lote_ids:
        db.execute(delete(LoteCartaoItem).where(getattr(LoteCartaoItem, "__table__").c.lote_cartao_id.in_(lote_ids)))

    integracao_ids = db.exec(
        select(IntegracaoBancaria.id).where(IntegracaoBancaria.empresa_id == empresa_id)
    ).all()

    deleted_mapeamentos = 0
    if integracao_ids:
        deleted_mapeamentos = db.execute(
            delete(MapeamentoCategoria).where(getattr(MapeamentoCategoria, "__table__").c.integracao_id.in_(integracao_ids))
        ).rowcount or 0  # type: ignore

    deleted_counts = {
        "baixas": db.execute(delete(Baixa).where(getattr(Baixa, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "movimentos": db.execute(delete(Movimento).where(getattr(Movimento, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "pdv_movimentacoes": db.execute(delete(PdvMovimentacao).where(getattr(PdvMovimentacao, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "lotes_cartao": db.execute(delete(LoteCartao).where(getattr(LoteCartao, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "regras_cartao": db.execute(delete(RegraCartao).where(getattr(RegraCartao, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "lancamentos_cartao": db.execute(delete(LancamentoCartao).where(getattr(LancamentoCartao, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "anexos": db.execute(delete(AnexoLancamento).where(getattr(AnexoLancamento, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "lancamentos": db.execute(delete(Lancamento).where(getattr(Lancamento, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "mapeamentos_categoria": deleted_mapeamentos,
        "integracoes_bancarias": db.execute(delete(IntegracaoBancaria).where(getattr(IntegracaoBancaria, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "cartoes": db.execute(delete(Cartao).where(getattr(Cartao, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "contas": db.execute(delete(Conta).where(getattr(Conta, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "entidades": db.execute(delete(Entidade).where(getattr(Entidade, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "centros_custo": db.execute(delete(CentroCusto).where(getattr(CentroCusto, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
        "plano_contas": db.execute(delete(PlanoContas).where(getattr(PlanoContas, "__table__").c.empresa_id == empresa_id)).rowcount or 0,  # type: ignore
    }

    db.add(CentroCusto(nome="principal", status="ATIVO", empresa_id=empresa_id))
    db.flush()
    _seed_company_chart_of_accounts(db=db, empresa_id=empresa_id, tipo_pessoa=empresa.tipo_pessoa or "PJ")
    db.commit()
    return deleted_counts

# --- CONFIGURAÇÃO DE UPLOAD ---
UPLOAD_DIR = Path("static/logos")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True) # Cria a pasta se não existir
MAX_LOGO_SIZE = 2 * 1024 * 1024

# --- ROTA BLINDADA: LISTAR TODAS ---
@router.get("/", response_model=List[EmpresaRead])
def read_empresas(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user = Depends(get_consultor_user)
):

    query = select(Empresa).where(Empresa.is_deleted == False)
    if not _is_super_consultor(current_user):
        from app.models.consultor_empresa import ConsultorEmpresa

        empresa_ids = db.exec(
            select(ConsultorEmpresa.empresa_id).where(
                ConsultorEmpresa.usuario_id == current_user.id,
                ConsultorEmpresa.ativo == True,
            )
        ).all()
        if not empresa_ids:
            return []
        query = query.where(getattr(Empresa, "__table__").c.id.in_(empresa_ids))

    empresas = db.exec(query.offset(skip).limit(limit)).all()
    return empresas

# --- ROTA BLINDADA: CRIAR EMPRESA ---
@router.post("/", response_model=EmpresaRead, status_code=201)
def create_endpoint(
    *,
    db: Session = Depends(get_db), 
    empresa_in: EmpresaCreate,
    current_user = Depends(get_super_consultor_user)
):
    logger.info(f"Criando empresa: {empresa_in.nome_fantasia}")
    
    if empresa_in.cnpj:
        existing = db.exec(select(Empresa).where(Empresa.cnpj == empresa_in.cnpj)).first()
        if existing:
            raise HTTPException(status_code=400, detail="CNPJ já cadastrado")

    empresa = create_empresa(db=db, empresa_in=empresa_in)
    return empresa

# --- ROTA HÍBRIDA: VER DETALHES ---
@router.get("/{empresa_id}", response_model=EmpresaRead)
def read_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    current_user = Depends(get_current_active_user)
):

    _ensure_empresa_access(current_user, db, empresa_id)
        
    empresa = get_empresa(db, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if not current_user.is_consultor and not empresa.is_active:
        raise HTTPException(status_code=403, detail="Empresa desativada")
    return empresa


@router.post("/{empresa_id}/resetar-base", dependencies=[Depends(require_permission("empresa:reset_base"))], include_in_schema=False)
def reset_company_financial_base(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    current_user = Depends(get_current_active_user)
):
    _ensure_empresa_access(current_user, db, empresa_id)

    authorized_emails = {"cirocaue12@gmail.com"}
    extra_emails = os.getenv("AUTHORIZED_RESET_EMAILS", "")
    if extra_emails:
        authorized_emails.update({e.strip() for e in extra_emails.split(",") if e.strip()})

    is_super = bool(current_user.is_consultor and str(current_user.consultor_role or "").upper() == "SUPER_CONSULTOR")
    if current_user.email not in authorized_emails and not is_super:
        raise HTTPException(
            status_code=403,
            detail="Apenas administradores autorizados têm permissão para resetar a base financeira da empresa."
        )

    empresa = get_empresa(db, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    try:
        deleted_counts = _hard_reset_company_financial_data(db, empresa=empresa)
        logger.warning(f"Reset financeiro executado para empresa {empresa_id} por {current_user.email}")
        return {
            "success": True,
            "message": "Empresa resetada com sucesso.",
            "deleted": deleted_counts,
            "empresa_id": empresa_id,
        }
    except Exception as exc:
        db.rollback()
        logger.error(f"Erro ao resetar empresa {empresa_id}: {exc}")
        raise HTTPException(status_code=500, detail="Erro ao resetar a base financeira da empresa.")

# --- ROTA HÍBRIDA: ATUALIZAR DADOS ---
@router.patch(
    "/{empresa_id}",
    response_model=EmpresaRead,
    dependencies=[Depends(require_permission("empresa:update"))],
)
def update_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    empresa_in: EmpresaUpdate,
    current_user = Depends(get_current_active_user)
):

    _ensure_empresa_access(current_user, db, empresa_id)

    db_obj = get_empresa(db, empresa_id)
    if not db_obj or db_obj.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if not current_user.is_consultor and not db_obj.is_active:
        raise HTTPException(status_code=403, detail="Empresa desativada")
        
    empresa = update_empresa(db=db, db_obj=db_obj, obj_in=empresa_in)
    logger.success(f"Empresa {empresa_id} atualizada")
    return empresa

# --- NOVA ROTA: UPLOAD DE LOGO ---
@router.post(
    "/{empresa_id}/logo",
    response_model=EmpresaRead,
    dependencies=[Depends(require_permission("empresa:update"))],
)
def upload_logo(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    file: UploadFile = File(...),
    current_user = Depends(get_current_active_user)
):
    """
    Recebe um arquivo de imagem, salva na pasta 'static/logos' 
    e atualiza a URL no banco de dados.
    """

    # 1. Verifica Permissão
    _ensure_empresa_access(current_user, db, empresa_id)

    db_obj = get_empresa(db, empresa_id)
    if not db_obj or db_obj.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = set(IMAGE_ALLOWED_EXT_TO_MIME.keys())
    if not ext or ext not in allowed_exts:
        raise HTTPException(400, detail="Extensão de arquivo inválida para logo.")

    # 2. Gera nome único para evitar cache do navegador (uuid)
    filename = f"logo_{empresa_id}_{uuid4().hex[:8]}{ext}"
    file_path = UPLOAD_DIR / filename

    # 3. Salva no Disco
    try:
        write_validated_upload_file(
            upload=file,
            destination=file_path,
            max_size=MAX_LOGO_SIZE,
            allowed_ext_to_mime=IMAGE_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        if exc.status_code == 413:
            raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except Exception as e:
        logger.error(f"Erro ao salvar arquivo: {e}")
        raise HTTPException(status_code=500, detail="Falha ao salvar imagem")

    # 4. Atualiza Banco (URL Relativa)
    url_relativa = f"/static/logos/{filename}"
    
    db_obj.logo_url = url_relativa
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    logger.success(f"Logo atualizada para empresa {empresa_id}: {url_relativa}")
    return db_obj
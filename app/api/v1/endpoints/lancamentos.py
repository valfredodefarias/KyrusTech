import pandas as pd
import io
import json
from pathlib import Path
from typing import List, Optional, Any, cast, Tuple
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, UploadFile, File, status, Form, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, col
from sqlalchemy.orm import selectinload
from loguru import logger

# --- Imports do Projeto ---
# Padronizando tudo para get_db para evitar erros de importação
from app.db.session import get_db
from app.models.usuario import Usuario
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas 
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade

# Dependências de Usuário e Empresa
from app.api.deps import get_current_user, get_empresa_id_from_user 

from app.services.lancamento_service import LancamentoService

# --- Schemas ---
from app.schemas.lancamento import (
    LancamentoCreate, LancamentoRead, LancamentoUpdate, 
    TransferenciaCreate, BulkActionSchema, BulkUpdateSchema
)
from app.schemas.anexo import AnexoRead, AnexoCreate

router = APIRouter()
MAX_ANEXO_NOME_LEN = 180
MAX_ANEXO_SIZE = 10 * 1024 * 1024


def _load_import_system_rows(session: Session, empresa_id: int) -> dict[str, list[dict[str, Any]]]:
    contas = session.exec(
        select(Conta.id, Conta.nome).where(Conta.empresa_id == empresa_id)
    ).all()
    categorias = session.exec(
        select(PlanoContas.id, PlanoContas.nome, PlanoContas.tipo, PlanoContas.codigo)
        .where(PlanoContas.empresa_id == empresa_id)
    ).all()
    centros = session.exec(
        select(CentroCusto.id, CentroCusto.nome).where(CentroCusto.empresa_id == empresa_id)
    ).all()
    entidades = session.exec(
        select(Entidade.id, Entidade.nome).where(Entidade.empresa_id == empresa_id)
    ).all()

    return {
        "contas": [{"id": conta_id, "nome": nome} for conta_id, nome in contas if conta_id is not None],
        "categorias": [
            {"id": categoria_id, "nome": nome, "tipo": tipo, "codigo": codigo}
            for categoria_id, nome, tipo, codigo in categorias
            if categoria_id is not None
        ],
        "centros": [{"id": centro_id, "nome": nome} for centro_id, nome in centros if centro_id is not None],
        "entidades": [{"id": entidade_id, "nome": nome} for entidade_id, nome in entidades if entidade_id is not None],
    }


def _build_import_name_map(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        str(row["nome"]).upper().strip(): int(row["id"])
        for row in rows
        if row.get("id") is not None and str(row.get("nome") or "").strip()
    }

# Padronizado para usar get_db
def get_service(session: Session = Depends(get_db)) -> LancamentoService:
    return LancamentoService(session)

def require_empresa_user(current_user: Usuario) -> Tuple[int, int]:
    if current_user.empresa_id is None or current_user.id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário sem empresa ou identificação válida."
        )
    return current_user.empresa_id, current_user.id

# ==========================================
# CRUD BÁSICO
# ==========================================

@router.get("/", response_model=List[LancamentoRead])
def listar_lancamentos(
    skip: int = 0,
    limit: int = 100,
    data_inicio: Optional[date] = Query(None),
    data_fim: Optional[date] = Query(None),
    conta_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista lançamentos com paginação."""
    query = select(Lancamento).options(selectinload(cast(Any, Lancamento.anexos))).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False
    )
    if data_inicio:
        query = query.where(Lancamento.data_vencimento >= data_inicio)
    if data_fim:
        query = query.where(Lancamento.data_vencimento <= data_fim)
    if conta_id:
        query = query.where(Lancamento.conta_id == conta_id)

    query = query.order_by(col(Lancamento.data_vencimento).asc()).offset(skip).limit(limit)
    
    return db.exec(query).all()

@router.post("/", response_model=LancamentoRead, status_code=status.HTTP_201_CREATED)
def criar_lancamento(lancamento_in: LancamentoCreate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.create(dados=lancamento_in, empresa_id=empresa_id, user_id=user_id)

@router.get("/{lancamento_id}", response_model=LancamentoRead)
def obter_lancamento(lancamento_id: int, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, _ = require_empresa_user(current_user)
    return service.get_by_id(lancamento_id, empresa_id)

@router.put("/{lancamento_id}", response_model=LancamentoRead)
def atualizar_lancamento(lancamento_id: int, lancamento_in: LancamentoUpdate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.update(lancamento_id=lancamento_id, dados_atualizacao=lancamento_in, empresa_id=empresa_id, user_id=user_id)

@router.delete("/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_lancamento(lancamento_id: int, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    service.delete(lancamento_id, empresa_id, user_id)

# ==========================================
# AÇÕES EM MASSA (BULK)
# ==========================================

@router.post("/bulk", response_model=List[LancamentoRead], status_code=status.HTTP_201_CREATED)
def criar_multiplos(lista_in: List[LancamentoCreate], service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.criar_em_massa(lista_in, empresa_id, user_id)

@router.post("/bulk-delete")
def deletar_multiplos(payload: BulkActionSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    service.deletar_em_massa(payload.ids, empresa_id, user_id)
    return {"msg": "Lançamentos deletados com sucesso"}

@router.post("/bulk-pay")
def baixar_multiplos(payload: BulkActionSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    if payload.data_pagamento is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Data de pagamento é obrigatória."
        )
    atualizados = service.baixar_em_massa(ids=payload.ids, data_pagamento=payload.data_pagamento, conta_id=payload.conta_id, empresa_id=empresa_id, user_id=user_id)
    return {"msg": f"{atualizados} lançamentos baixados com sucesso"}

@router.post("/bulk-update")
def atualizar_multiplos(payload: BulkUpdateSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.atualizar_em_massa(payload=payload, empresa_id=empresa_id, user_id=user_id)

# ==========================================
# AÇÕES ESPECIAIS E ANEXOS
# ==========================================

@router.post("/transferir")
def transferir_valores(transf_in: TransferenciaCreate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.transferir(transf_in, empresa_id, user_id)

@router.post("/{lancamento_id}/anexos", response_model=List[AnexoRead])
def upload_anexos(lancamento_id: int, files: List[UploadFile] = File(...), tipo: str = Query("OUTROS"), service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    anexos_criados = []
    empresa_id, user_id = require_empresa_user(current_user)
    for file in files:
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo inválido: nome do arquivo ausente."
            )
        nome_arquivo = Path(file.filename).name.strip()
        if not nome_arquivo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo inválido: nome do arquivo ausente.")
        if len(nome_arquivo) > MAX_ANEXO_NOME_LEN:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome do arquivo excede o limite permitido.")
        tamanho_bytes = int(getattr(file, "size", 0) or 0)
        if tamanho_bytes and tamanho_bytes > MAX_ANEXO_SIZE:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Arquivo muito grande. Máximo 10MB por anexo.")
        url_fake = f"https://storage.kyrus.com/{empresa_id}/{lancamento_id}/{nome_arquivo}"
        dados = AnexoCreate(nome_arquivo=nome_arquivo, url=url_fake, tipo=tipo, tamanho_bytes=tamanho_bytes, content_type=file.content_type, lancamento_id=lancamento_id, empresa_id=empresa_id)
        anexos_criados.append(service.adicionar_anexo(lancamento_id, dados, empresa_id, user_id))
    return anexos_criados

# ==========================================
# IMPORTAÇÃO INTELIGENTE (VERSÃO SÊNIOR)
# ==========================================

def encontrar_coluna(df: pd.DataFrame, possiveis_nomes: list) -> str:
    colunas_upper = {c.upper().strip(): c for c in df.columns}
    for nome in possiveis_nomes:
        if nome in colunas_upper: return colunas_upper[nome]
    return ""

@router.get("/importar/modelo", response_class=StreamingResponse)
def download_modelo_importacao():
    df = pd.DataFrame(columns=["DATA VENCIMENTO", "DATA PAGAMENTO", "DESCRIÇÃO", "VALOR", "CONTA", "CATEGORIA", "CENTRO DE CUSTO", "ENTIDADE"])
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Importacao')
    output.seek(0)
    return StreamingResponse(output, headers={'Content-Disposition': 'attachment; filename="modelo_kyrus.xlsx"'}, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@router.post("/importar/analisar")
def analisar_arquivo_importacao(file: UploadFile = File(...), session: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    empresa_id, _ = require_empresa_user(current_user)
    df = pd.read_excel(io.BytesIO(file.file.read()))
    df.columns = [str(c).upper().strip() for c in df.columns]
    col_conta = encontrar_coluna(df, ["CONTA", "BANCO"])
    col_cat = encontrar_coluna(df, ["CATEGORIA", "PLANO DE CONTAS"])
    col_centro = encontrar_coluna(df, ["CENTRO DE CUSTO", "CENTRO", "FILIAL", "CENTRO_CUSTO"])
    col_entidade = encontrar_coluna(df, ["ENTIDADE", "CLIENTE", "FORNECEDOR"])
    sistema = _load_import_system_rows(session, empresa_id)
    nomes_contas = _build_import_name_map(sistema["contas"])
    nomes_cats = _build_import_name_map(sistema["categorias"])
    nomes_centros = _build_import_name_map(sistema["centros"])
    nomes_entidades = _build_import_name_map(sistema["entidades"])
    conflitos = {
        "contas": [c for c in df[col_conta].unique().tolist() if pd.notna(c) and str(c).strip() and str(c).upper().strip() not in nomes_contas] if col_conta else [],
        "categorias": [c for c in df[col_cat].unique().tolist() if pd.notna(c) and str(c).strip() and str(c).upper().strip() not in nomes_cats] if col_cat else [],
        "centros": [c for c in df[col_centro].unique().tolist() if pd.notna(c) and str(c).strip() and str(c).upper().strip() not in nomes_centros] if col_centro else [],
        "entidades": [c for c in df[col_entidade].unique().tolist() if pd.notna(c) and str(c).strip() and str(c).upper().strip() not in nomes_entidades] if col_entidade else []
    }
    return {
        "conflitos": conflitos,
        "sistema": sistema
    }


# ==========================================
# IMPORTAÇÃO INTELIGENTE
# ==========================================

class ImportacaoRequest:
    """Requisição para importação via formulário."""
    file: UploadFile
    mapeamento_json: str


@router.post("/importar/executar")
async def importar_executar(
    file: UploadFile = File(...),
    mapeamento_json: str = Form(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Endpoint para importação de lançamentos com mapeamento de categorias.
    Recebe arquivo XLSX e JSON com mapeamento de categorias/entidades/contas/centros.
    """
    if not file.filename or not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser XLSX ou XLS"
        )
    
    try:
        # Parse do mapeamento
        mapeamento = json.loads(mapeamento_json)
        map_categorias = {str(k).upper().strip(): v for k, v in mapeamento.get('map_categorias', {}).items() if v is not None}
        map_contas = {str(k).upper().strip(): v for k, v in mapeamento.get('map_contas', {}).items() if v is not None}
        map_centros = {str(k).upper().strip(): v for k, v in mapeamento.get('map_centros', {}).items() if v is not None}
        map_entidades = {str(k).upper().strip(): v for k, v in mapeamento.get('map_entidades', {}).items() if v is not None}
        
        # Lê o arquivo
        conteudo = await file.read()
        df = pd.read_excel(io.BytesIO(conteudo))
        df.columns = [str(c).upper().strip() for c in df.columns]
        
        empresa_id, _ = require_empresa_user(current_user)
        erros = []
        importados = 0
        
        # Colunas principais (com fallback)
        col_venc = encontrar_coluna(df, ["DATA VENCIMENTO", "VENCIMENTO", "DATA"])
        col_pag = encontrar_coluna(df, ["DATA PAGAMENTO", "PAGAMENTO"])
        col_desc = encontrar_coluna(df, ["DESCRIÇÃO", "DESCRICAO", "HISTÓRICO", "HISTORICO"])
        col_valor = encontrar_coluna(df, ["VALOR", "VALOR PAGO", "VALOR PREVISTO"])
        col_cat = encontrar_coluna(df, ["CATEGORIA", "PLANO DE CONTAS"])
        col_ent = encontrar_coluna(df, ["ENTIDADE", "CLIENTE", "FORNECEDOR"])
        col_conta = encontrar_coluna(df, ["CONTA", "BANCO"])
        col_centro = encontrar_coluna(df, ["CENTRO DE CUSTO", "CENTRO", "FILIAL", "CENTRO_CUSTO"])
        col_tipo = encontrar_coluna(df, ["TIPO"])

        # Caches do sistema
        sistema = _load_import_system_rows(db, empresa_id)
        cache_tipos = {int(item["id"]): item.get("tipo") for item in sistema["categorias"] if item.get("id") is not None}
        nomes_cats_sist = _build_import_name_map(sistema["categorias"])
        nomes_contas_sist = _build_import_name_map(sistema["contas"])
        nomes_centros_sist = _build_import_name_map(sistema["centros"])
        nomes_entidades_sist = _build_import_name_map(sistema["entidades"])

        for row_idx, (_, row) in enumerate(df.iterrows(), start=2):
            try:
                if col_venc and pd.isna(row[col_venc]):
                    continue

                descricao = str(row[col_desc]).strip() if col_desc and pd.notna(row[col_desc]) else ""
                tipo_raw = str(row[col_tipo]).upper().strip() if col_tipo and pd.notna(row[col_tipo]) else ""
                tipo = "RECEITA" if tipo_raw.startswith("R") else ("DESPESA" if tipo_raw else "")
                valor_raw = row[col_valor] if col_valor else None
                valor = Decimal(str(valor_raw).replace(',', '.')) if pd.notna(valor_raw) else Decimal("0.00")
                data_venc_raw = row[col_venc] if col_venc else None
                data_pag_raw = row[col_pag] if col_pag else None
                categoria_nome = str(row[col_cat]).strip() if col_cat and pd.notna(row[col_cat]) else "A Categorizar"
                entidade_nome = str(row[col_ent]).strip() if col_ent and pd.notna(row[col_ent]) else ""
                conta_nome = str(row[col_conta]).strip() if col_conta and pd.notna(row[col_conta]) else ""
                centro_nome = str(row[col_centro]).strip() if col_centro and pd.notna(row[col_centro]) else ""
                
                # Mapeia para IDs usando mapeamento
                plano_contas_id = None
                cat_key = categoria_nome.upper().strip()
                if cat_key in map_categorias and map_categorias[cat_key] is not None:
                    plano_contas_id = int(map_categorias[cat_key])
                elif cat_key in nomes_cats_sist and nomes_cats_sist[cat_key] is not None:
                    plano_contas_id = int(nomes_cats_sist[cat_key])
                else:
                    # Busca categoria no sistema ou cria "A Categorizar"
                    categoria = db.exec(
                        select(PlanoContas).where(
                            PlanoContas.empresa_id == empresa_id,
                            PlanoContas.nome == "A Categorizar",
                            PlanoContas.tipo == ("R" if tipo == "RECEITA" else "D")
                        )
                    ).first()
                    if not categoria:
                        categoria = PlanoContas(
                            nome="A Categorizar",
                            codigo=None,
                            tipo=("R" if tipo == "RECEITA" else "D"),
                            empresa_id=empresa_id,
                            permite_lancamentos=True
                        )
                        db.add(categoria)
                        db.flush()
                    plano_contas_id = categoria.id

                if not tipo and plano_contas_id is not None:
                    tipo = "RECEITA" if cache_tipos.get(int(plano_contas_id)) == "R" else "DESPESA"
                
                # Mapeia entidade
                entidade_id = None
                entidade_id = None
                ent_key = entidade_nome.upper().strip() if entidade_nome else ""
                if ent_key:
                    if ent_key in map_entidades and map_entidades[ent_key] is not None:
                        entidade_id = int(map_entidades[ent_key])
                    elif ent_key in nomes_entidades_sist and nomes_entidades_sist[ent_key] is not None:
                        entidade_id = int(nomes_entidades_sist[ent_key])
                    else:
                        nova_ent = Entidade(nome=entidade_nome, tipo="AMBOS", cpf_cnpj=None, status="ATIVO", empresa_id=empresa_id)
                        db.add(nova_ent)
                        db.flush()
                        if nova_ent.id is None:
                            raise Exception("Falha ao criar entidade")
                        entidade_id = int(nova_ent.id)
                        nomes_entidades_sist[ent_key] = entidade_id
                
                # Mapeia conta
                conta_id = None
                conta_id = None
                conta_key = conta_nome.upper().strip() if conta_nome else ""
                if conta_key:
                    if conta_key in map_contas and map_contas[conta_key] is not None:
                        conta_id = int(map_contas[conta_key])
                    elif conta_key in nomes_contas_sist and nomes_contas_sist[conta_key] is not None:
                        conta_id = int(nomes_contas_sist[conta_key])
                
                # Mapeia centro de custo
                centro_custo_id = None
                centro_custo_id = None
                centro_key = centro_nome.upper().strip() if centro_nome else ""
                if centro_key:
                    if centro_key in map_centros and map_centros[centro_key] is not None:
                        centro_custo_id = int(map_centros[centro_key])
                    elif centro_key in nomes_centros_sist and nomes_centros_sist[centro_key] is not None:
                        centro_custo_id = int(nomes_centros_sist[centro_key])
                    else:
                        novo_centro = CentroCusto(nome=centro_nome, empresa_id=empresa_id)
                        db.add(novo_centro)
                        db.flush()
                        if novo_centro.id is None:
                            raise Exception("Falha ao criar centro de custo")
                        centro_custo_id = int(novo_centro.id)
                        nomes_centros_sist[centro_key] = centro_custo_id
                
                # Parse da data
                data_vencimento = pd.to_datetime(data_venc_raw, dayfirst=True).date() if pd.notna(data_venc_raw) else None
                data_pagamento = pd.to_datetime(data_pag_raw, dayfirst=True).date() if pd.notna(data_pag_raw) and str(data_pag_raw).strip() != '' else None
                if not data_vencimento:
                    raise Exception("Data de vencimento inválida")
                
                # Cria lançamento
                novo_lancamento = Lancamento(
                    descricao=descricao,
                    tipo=tipo,
                    origem="IMPORTACAO",
                    valor_previsto=Decimal(str(valor)),
                    valor_pago=Decimal(str(valor)) if data_pagamento else Decimal("0.00"),
                    data_vencimento=data_vencimento,
                    data_pagamento=data_pagamento,
                    data_competencia=data_vencimento,
                    empresa_id=empresa_id,
                    plano_contas_id=plano_contas_id,
                    entidade_id=entidade_id,
                    conta_id=conta_id,
                    centro_custo_id=centro_custo_id,
                    ipp=False
                )
                
                db.add(novo_lancamento)
                importados += 1
                
            except Exception as e:
                logger.error(f"Erro na linha {row_idx}: {e}")
                erros.append(f"Linha {row_idx}: {str(e)}")
        
        db.commit()
        
        return {
            "sucesso": True,
            "importados": importados,
            "erros": erros
        }
        
    except Exception as e:
        logger.error(f"Erro ao processar importação: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )
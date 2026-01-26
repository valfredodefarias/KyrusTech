import pandas as pd
import io
import json
from typing import List, Optional, Any
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, UploadFile, File, status, Form, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, col
from loguru import logger

# --- Imports do Projeto ---
from app.db.session import get_session
from app.models.usuario import Usuario
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas 
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.api.deps import get_current_user
from app.services.lancamento_service import LancamentoService

# --- Schemas ---
from app.schemas.lancamento import (
    LancamentoCreate, LancamentoRead, LancamentoUpdate, 
    TransferenciaCreate, BulkActionSchema, BulkUpdateSchema
)
from app.schemas.anexo import AnexoRead, AnexoCreate

router = APIRouter()

def get_service(session: Session = Depends(get_session)) -> LancamentoService:
    return LancamentoService(session)

# ==========================================
# CRUD BÁSICO
# ==========================================

@router.get("/", response_model=List[LancamentoRead])
def listar_lancamentos(
    skip: int = 0, limit: int = 100,
    data_inicio: Optional[date] = Query(None),
    data_fim: Optional[date] = Query(None),
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
):
    return service.listar(empresa_id=current_user.empresa_id, skip=skip, limit=limit, data_inicio=data_inicio, data_fim=data_fim)

@router.post("/", response_model=LancamentoRead, status_code=status.HTTP_201_CREATED)
def criar_lancamento(lancamento_in: LancamentoCreate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    return service.create(dados=lancamento_in, empresa_id=current_user.empresa_id, user_id=current_user.id)

@router.get("/{lancamento_id}", response_model=LancamentoRead)
def obter_lancamento(lancamento_id: int, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    return service.get_by_id(lancamento_id, current_user.empresa_id)

@router.put("/{lancamento_id}", response_model=LancamentoRead)
def atualizar_lancamento(lancamento_id: int, lancamento_in: LancamentoUpdate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    return service.update(lancamento_id=lancamento_id, dados_atualizacao=lancamento_in, empresa_id=current_user.empresa_id, user_id=current_user.id)

@router.delete("/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_lancamento(lancamento_id: int, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    service.delete(lancamento_id, current_user.empresa_id, current_user.id)

# ==========================================
# AÇÕES EM MASSA (BULK)
# ==========================================

@router.post("/bulk", response_model=List[LancamentoRead], status_code=status.HTTP_201_CREATED)
def criar_multiplos(lista_in: List[LancamentoCreate], service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    return service.criar_em_massa(lista_in, current_user.empresa_id, current_user.id)

@router.post("/bulk-delete")
def deletar_multiplos(payload: BulkActionSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    service.deletar_em_massa(payload.ids, current_user.empresa_id, current_user.id)
    return {"msg": "Lançamentos deletados com sucesso"}

@router.post("/bulk-pay")
def baixar_multiplos(payload: BulkActionSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    atualizados = service.baixar_em_massa(ids=payload.ids, data_pagamento=payload.data_pagamento, conta_id=payload.conta_id, empresa_id=current_user.empresa_id, user_id=current_user.id)
    return {"msg": f"{atualizados} lançamentos baixados com sucesso"}

@router.post("/bulk-update")
def atualizar_multiplos(payload: BulkUpdateSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    return service.atualizar_em_massa(payload=payload, empresa_id=current_user.empresa_id, user_id=current_user.id)

# ==========================================
# AÇÕES ESPECIAIS E ANEXOS
# ==========================================

@router.post("/transferir")
def transferir_valores(transf_in: TransferenciaCreate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    return service.transferir(transf_in, current_user.empresa_id, current_user.id)

@router.post("/{lancamento_id}/anexos", response_model=List[AnexoRead])
def upload_anexos(lancamento_id: int, files: List[UploadFile] = File(...), tipo: str = Query("OUTROS"), service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    anexos_criados = []
    for file in files:
        url_fake = f"https://storage.kyrus.com/{current_user.empresa_id}/{lancamento_id}/{file.filename}"
        dados = AnexoCreate(nome_arquivo=file.filename, url=url_fake, tipo=tipo, tamanho_bytes=file.size, content_type=file.content_type, lancamento_id=lancamento_id, empresa_id=current_user.empresa_id)
        anexos_criados.append(service.adicionar_anexo(lancamento_id, dados, current_user.empresa_id, current_user.id))
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
    df = pd.DataFrame(columns=["DATA VENCIMENTO", "DATA PAGAMENTO", "DESCRIÇÃO", "VALOR", "CONTA", "CATEGORIA", "CENTRO DE CUSTO"])
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Importacao')
    output.seek(0)
    return StreamingResponse(output, headers={'Content-Disposition': 'attachment; filename="modelo_kyrus.xlsx"'}, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@router.post("/importar/analisar")
def analisar_arquivo_importacao(file: UploadFile = File(...), session: Session = Depends(get_session), current_user: Usuario = Depends(get_current_user)):
    df = pd.read_excel(io.BytesIO(file.file.read()))
    df.columns = [str(c).upper().strip() for c in df.columns]
    col_conta = encontrar_coluna(df, ["CONTA", "BANCO"])
    col_cat = encontrar_coluna(df, ["CATEGORIA", "PLANO DE CONTAS"])
    sist_contas = session.exec(select(Conta).where(Conta.empresa_id == current_user.empresa_id)).all()
    sist_cats = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == current_user.empresa_id)).all()
    sist_centros = session.exec(select(CentroCusto).where(CentroCusto.empresa_id == current_user.empresa_id)).all()
    nomes_contas = {c.nome.upper().strip(): c.id for c in sist_contas}
    nomes_cats = {c.nome.upper().strip(): c.id for c in sist_cats}
    conflitos = {
        "contas": [c for c in df[col_conta].unique().tolist() if pd.notna(c) and str(c).strip() and str(c).upper().strip() not in nomes_contas] if col_conta else [],
        "categorias": [c for c in df[col_cat].unique().tolist() if pd.notna(c) and str(c).strip() and str(c).upper().strip() not in nomes_cats] if col_cat else [],
        "centros": []
    }
    return {"conflitos": conflitos, "sistema": {"contas": [{"id": c.id, "nome": c.nome} for c in sist_contas], "categorias": [{"id": c.id, "nome": c.nome, "tipo": c.tipo, "codigo": c.codigo} for c in sist_cats], "centros": [{"id": c.id, "nome": c.nome} for c in sist_centros]}}

@router.post("/importar/executar")
def executar_importacao(file: UploadFile = File(...), mapeamento_json: str = Form(...), conta_padrao_id: Optional[int] = Form(None), session: Session = Depends(get_session), current_user: Usuario = Depends(get_current_user)):
    mapeamento = json.loads(mapeamento_json)
    empresa_id = current_user.empresa_id
    # Caches do sistema (Performance Sênior)
    cats_query = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == empresa_id)).all()
    cache_tipos = {c.id: c.tipo for c in cats_query}
    nomes_cats_sist = {c.nome.strip().upper(): c.id for c in cats_query}
    nomes_contas_sist = {c.nome.strip().upper(): c.id for c in session.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()}
    nomes_centros_sist = {c.nome.strip().upper(): c.id for c in session.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).all()}
    
    map_cats = {str(k).upper().strip(): v for k, v in mapeamento.get('map_categorias', {}).items()}
    map_contas = {str(k).upper().strip(): v for k, v in mapeamento.get('map_contas', {}).items()}
    
    df = pd.read_excel(io.BytesIO(file.file.read()))
    df.columns = [str(c).upper().strip() for c in df.columns]
    col_venc, col_pag, col_desc, col_valor = df.columns[0], df.columns[1], df.columns[2], df.columns[3]
    col_conta, col_cat, col_centro = encontrar_coluna(df, ["CONTA", "BANCO"]), encontrar_coluna(df, ["CATEGORIA", "PLANO DE CONTAS"]), encontrar_coluna(df, ["CENTRO DE CUSTO", "FILIAL"])

    rows_saved, erros = 0, []
    for index, row in df.iterrows():
        try:
            if pd.isna(row[col_venc]): continue
            dt_venc = pd.to_datetime(row[col_venc], dayfirst=True).date()
            dt_pag = pd.to_datetime(row[col_pag], dayfirst=True).date() if pd.notna(row[col_pag]) and str(row[col_pag]).strip() != '' else None
            valor = Decimal(str(row[col_valor]).replace(',', '.')) if pd.notna(row[col_valor]) else Decimal("0.00")
            
            nome_cat = str(row[col_cat]).upper().strip() if col_cat and pd.notna(row[col_cat]) else ""
            cat_id = map_cats.get(nome_cat) or nomes_cats_sist.get(nome_cat)
            if not cat_id: raise Exception(f"Categoria '{nome_cat}' não mapeada.")
            
            use_conta_id = None
            nome_conta = str(row[col_conta]).upper().strip() if col_conta and pd.notna(row[col_conta]) else ""
            if nome_conta and nome_conta not in ('NAN', ''):
                use_conta_id = map_contas.get(nome_conta) or nomes_contas_sist.get(nome_conta)
            if not use_conta_id: use_conta_id = conta_padrao_id # Fallback para NFEs/Previsões

            cc_id = nomes_centros_sist.get(str(row[col_centro]).upper().strip()) if col_centro and pd.notna(row[col_centro]) else None

            novo = Lancamento(
                descricao=str(row[col_desc])[:250],
                tipo=cache_tipos.get(int(cat_id), "DESPESA"),
                valor_previsto=valor,
                valor_pago=valor if dt_pag else Decimal("0.00"),
                data_vencimento=dt_venc,
                data_pagamento=dt_pag,
                data_competencia=dt_venc,
                plano_contas_id=int(cat_id),
                conta_id=int(use_conta_id) if use_conta_id else None,
                centro_custo_id=cc_id,
                empresa_id=empresa_id
            )
            session.add(novo)
            rows_saved += 1
        except Exception as e: erros.append(f"Linha {index+2}: {str(e)}")
    
    session.commit()
    return {"importados": rows_saved, "erros": erros}
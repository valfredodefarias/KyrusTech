"""
Endpoints para importação de arquivos do Itaú.
"""
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlmodel import Session
from loguru import logger
from typing import List, Dict, Optional
import io

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user
from app.services.integracao_itau import (
    processar_extrato_itau,
    processar_relatorio_pagamentos_itau,
    verificar_duplicata,
    buscar_lancamento_previsto_mesmo_dia_valor,
    buscar_lancamento_atrasado_mesmo_valor,
    criar_entidade_se_nao_existir,
    gerar_import_hash
)
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from sqlmodel import select
from pydantic import BaseModel

router = APIRouter()


def _serializar_lancamento(lanc_raw: Dict) -> Dict:
    payload = dict(lanc_raw)
    data_val = payload.get("data")
    if isinstance(data_val, date):
        payload["data"] = data_val.isoformat()
    data_hora_val = payload.get("data_hora")
    if isinstance(data_hora_val, datetime):
        payload["data_hora"] = data_hora_val.isoformat()
    return payload


class LancamentoImportado(BaseModel):
    """Schema para lançamento importado do arquivo"""
    data: str
    data_hora: Optional[str] = None
    descricao: str
    razao_social: str
    cpf_cnpj: str
    referencia: Optional[str] = None
    valor: float
    tipo: str
    origem: str
    linha_arquivo: int
    import_hash: Optional[str] = None
    # Campos de matching
    lancamento_previsto_id: Optional[int] = None
    lancamentos_atrasados_ids: List[int] = []
    duplicata_id: Optional[int] = None
    # Campos para categorização
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    era_previsto: bool = False


class ProcessarArquivoResponse(BaseModel):
    """Resposta do processamento de arquivo"""
    lancamentos: List[LancamentoImportado]
    total_processado: int
    duplicatas_encontradas: int
    lancamentos_previstos_encontrados: int
    lancamentos_atrasados_encontrados: int


@router.post("/upload-extrato", response_model=ProcessarArquivoResponse)
async def upload_extrato(
    arquivo: UploadFile = File(...),
    conta_id: Optional[int] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Faz upload e processa arquivo XLSX de extrato do Itaú (recebimentos).
    Recebe conta_id e centro_custo_id para buscar lançamentos previstos no mesmo centro de custo.
    """
    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser XLSX ou XLS"
        )
    
    try:
        conta, centro_custo_id_resolvido = _resolver_conta_e_centro(db, empresa_id, conta_id)

        conteudo = await arquivo.read()
        lancamentos_raw = processar_extrato_itau(conteudo, empresa_id)
        
        # Processa cada lançamento para matching
        lancamentos_processados = []
        duplicatas = 0
        previstos = 0
        atrasados = 0
        
        for lanc_raw in lancamentos_raw:
            # Adiciona conta e centro de custo derivados da conta
            lanc_raw["conta_id"] = conta.id
            lanc_raw["centro_custo_id"] = centro_custo_id_resolvido
            lanc_raw["import_hash"] = gerar_import_hash(lanc_raw, conta_id=conta.id)

            # Verifica duplicata
            duplicata = verificar_duplicata(db, lanc_raw, empresa_id, conta_id=conta.id)
            if duplicata:
                duplicatas += 1
                lanc_raw["duplicata_id"] = duplicata.id
                continue  # Pula duplicatas
            
            # Busca lançamento previsto (considerando centro de custo se fornecido)
            lanc_previsto = buscar_lancamento_previsto_mesmo_dia_valor(
                db, lanc_raw, empresa_id, centro_custo_id=centro_custo_id_resolvido
            )
            if lanc_previsto:
                previstos += 1
                lanc_raw["lancamento_previsto_id"] = lanc_previsto.id
                lanc_raw["era_previsto"] = True
            
            # Busca lançamentos atrasados (considerando centro de custo se fornecido)
            lancs_atrasados = buscar_lancamento_atrasado_mesmo_valor(
                db, lanc_raw, empresa_id, centro_custo_id=centro_custo_id_resolvido
            )
            if lancs_atrasados:
                atrasados += 1
                lanc_raw["lancamentos_atrasados_ids"] = [l.id for l in lancs_atrasados]
            
            # Cria/busca entidade
            entidade_id = criar_entidade_se_nao_existir(
                db,
                lanc_raw.get("razao_social", ""),
                lanc_raw.get("cpf_cnpj", ""),
                empresa_id
            )
            lanc_raw["entidade_id"] = entidade_id
            
            lancamentos_processados.append(LancamentoImportado(**_serializar_lancamento(lanc_raw)))
        
        return ProcessarArquivoResponse(
            lancamentos=lancamentos_processados,
            total_processado=len(lancamentos_raw),
            duplicatas_encontradas=duplicatas,
            lancamentos_previstos_encontrados=previstos,
            lancamentos_atrasados_encontrados=atrasados
        )
        
    except Exception as e:
        logger.error(f"Erro ao processar extrato: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


@router.post("/upload-pagamentos", response_model=ProcessarArquivoResponse)
async def upload_pagamentos(
    arquivo: UploadFile = File(...),
    conta_id: Optional[int] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Faz upload e processa arquivo XLSX de relatório de pagamentos do Itaú (despesas).
    Recebe conta_id e centro_custo_id para buscar lançamentos previstos no mesmo centro de custo.
    """
    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser XLSX ou XLS"
        )
    
    try:
        conta, centro_custo_id_resolvido = _resolver_conta_e_centro(db, empresa_id, conta_id)

        conteudo = await arquivo.read()
        lancamentos_raw = processar_relatorio_pagamentos_itau(conteudo, empresa_id)
        
        # Processa cada lançamento para matching
        lancamentos_processados = []
        duplicatas = 0
        previstos = 0
        atrasados = 0
        
        for lanc_raw in lancamentos_raw:
            # Adiciona conta e centro de custo derivados da conta
            lanc_raw["conta_id"] = conta.id
            lanc_raw["centro_custo_id"] = centro_custo_id_resolvido
            lanc_raw["import_hash"] = gerar_import_hash(lanc_raw, conta_id=conta.id)

            # Verifica duplicata
            duplicata = verificar_duplicata(db, lanc_raw, empresa_id, conta_id=conta.id)
            if duplicata:
                duplicatas += 1
                lanc_raw["duplicata_id"] = duplicata.id
                continue  # Pula duplicatas
            
            # Busca lançamento previsto (considerando centro de custo se fornecido)
            lanc_previsto = buscar_lancamento_previsto_mesmo_dia_valor(
                db, lanc_raw, empresa_id, centro_custo_id=centro_custo_id_resolvido
            )
            if lanc_previsto:
                previstos += 1
                lanc_raw["lancamento_previsto_id"] = lanc_previsto.id
                lanc_raw["era_previsto"] = True
            
            # Busca lançamentos atrasados (considerando centro de custo se fornecido)
            lancs_atrasados = buscar_lancamento_atrasado_mesmo_valor(
                db, lanc_raw, empresa_id, centro_custo_id=centro_custo_id_resolvido
            )
            if lancs_atrasados:
                atrasados += 1
                lanc_raw["lancamentos_atrasados_ids"] = [l.id for l in lancs_atrasados]
            
            # Cria/busca entidade
            entidade_id = criar_entidade_se_nao_existir(
                db,
                lanc_raw.get("razao_social", ""),
                lanc_raw.get("cpf_cnpj", ""),
                empresa_id
            )
            lanc_raw["entidade_id"] = entidade_id
            
            lancamentos_processados.append(LancamentoImportado(**_serializar_lancamento(lanc_raw)))
        
        return ProcessarArquivoResponse(
            lancamentos=lancamentos_processados,
            total_processado=len(lancamentos_raw),
            duplicatas_encontradas=duplicatas,
            lancamentos_previstos_encontrados=previstos,
            lancamentos_atrasados_encontrados=atrasados
        )
        
    except Exception as e:
        logger.error(f"Erro ao processar relatório de pagamentos: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


class ConfirmarLancamentosRequest(BaseModel):
    """Request para confirmar e criar lançamentos"""
    lancamentos: List[Dict]  # Lista de lançamentos com categorias definidas
    conta_id: Optional[int] = None  # Conta bancária para associar aos lançamentos
    centro_custo_id: Optional[int] = None  # Centro de custo padrão para os lançamentos


@router.post("/confirmar-lancamentos")
async def confirmar_lancamentos(
    request: ConfirmarLancamentosRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Confirma e cria os lançamentos importados com suas categorias.
    """
    lancamentos_criados = 0
    lancamentos_atualizados = 0
    erros = []
    
    conta_resolvida = None
    centro_custo_resolvido = None
    if request.conta_id:
        conta_resolvida, centro_custo_resolvido = _resolver_conta_e_centro(db, empresa_id, request.conta_id)

    for lanc_data in request.lancamentos:
        try:
            # Ignora duplicatas e itens descartados manualmente na fila
            if lanc_data.get("sugestao_acao") in {"IGNORAR_DUPLICATA", "DESCARTAR"}:
                continue

            # Se tem duplicata, pula
            if lanc_data.get("duplicata_id"):
                continue
            
            # Importa funções necessárias
            from datetime import date
            from decimal import Decimal
            from app.services.integracao_itau import parsear_data
            
            # Se tem lançamento previsto, atualiza
            if lanc_data.get("lancamento_previsto_id"):
                lanc_existente = db.get(Lancamento, lanc_data["lancamento_previsto_id"])
                if lanc_existente:
                    # Usa data_pagamento se fornecido, senão usa data
                    data_pagamento = None
                    if lanc_data.get("data_pagamento"):
                        data_pagamento = parsear_data(lanc_data["data_pagamento"])
                    elif lanc_data.get("data"):
                        data_pagamento = parsear_data(lanc_data["data"])
                    
                    # Usa data_vencimento se fornecido, senão mantém a original
                    if lanc_data.get("data_vencimento"):
                        data_vencimento = parsear_data(lanc_data["data_vencimento"])
                        lanc_existente.data_vencimento = data_vencimento
                    
                    lanc_existente.data_pagamento = data_pagamento
                    lanc_existente.status = "PAGO"
                    lanc_existente.conciliado = True
                    lanc_existente.valor_pago = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
                    if lanc_data.get("plano_contas_id"):
                        lanc_existente.plano_contas_id = lanc_data["plano_contas_id"]
                    if lanc_data.get("entidade_id"):
                        lanc_existente.entidade_id = lanc_data["entidade_id"]
                    # Atualiza conta e centro de custo se fornecidos
                    if conta_resolvida:
                        lanc_existente.conta_id = conta_resolvida.id
                    if centro_custo_resolvido:
                        lanc_existente.centro_custo_id = centro_custo_resolvido
                    if lanc_data.get("import_hash") and not lanc_existente.import_hash:
                        lanc_existente.import_hash = lanc_data["import_hash"]
                    db.add(lanc_existente)
                    lancamentos_atualizados += 1
                    continue
            
            # Se tem relacionamento com lançamentos atrasados, atualiza eles
            if lanc_data.get("lancamentos_atrasados_relacionados"):
                for atrasado_id in lanc_data["lancamentos_atrasados_relacionados"]:
                    lanc_atrasado = db.get(Lancamento, atrasado_id)
                    if lanc_atrasado:
                        data_pagamento = None
                        if lanc_data.get("data_pagamento"):
                            data_pagamento = parsear_data(lanc_data["data_pagamento"])
                        elif lanc_data.get("data"):
                            data_pagamento = parsear_data(lanc_data["data"])
                        
                        lanc_atrasado.data_pagamento = data_pagamento
                        lanc_atrasado.status = "PAGO"
                        lanc_atrasado.conciliado = True
                        lanc_atrasado.valor_pago = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
                        if lanc_data.get("plano_contas_id"):
                            lanc_atrasado.plano_contas_id = lanc_data["plano_contas_id"]
                        if request.conta_id:
                            lanc_atrasado.conta_id = conta_resolvida.id if conta_resolvida else request.conta_id
                        if centro_custo_resolvido:
                            lanc_atrasado.centro_custo_id = centro_custo_resolvido
                        if lanc_data.get("import_hash") and not lanc_atrasado.import_hash:
                            lanc_atrasado.import_hash = lanc_data["import_hash"]
                        db.add(lanc_atrasado)
                        lancamentos_atualizados += 1
                
                # Se relacionou com atrasados, não cria novo lançamento
                if lanc_data.get("relacionar_apenas_atrasados"):
                    continue
            
            # Cria novo lançamento
            
            plano_contas_id = lanc_data.get("plano_contas_id")
            if not plano_contas_id:
                # Busca categoria "A Categorizar"
                categoria = db.exec(
                    select(PlanoContas).where(
                        PlanoContas.empresa_id == empresa_id,
                        PlanoContas.nome.ilike("%categorizar%")
                    )
                ).first()
                if categoria:
                    plano_contas_id = categoria.id
                else:
                    # Cria categoria "A Categorizar" se não existir
                    tipo_categoria = "R" if lanc_data.get("tipo") == "RECEITA" else "D"
                    categoria_nova = PlanoContas(
                        nome="A Categorizar",
                        tipo=tipo_categoria,
                        empresa_id=empresa_id,
                        permite_lancamentos=True
                    )
                    db.add(categoria_nova)
                    db.commit()
                    db.refresh(categoria_nova)
                    plano_contas_id = categoria_nova.id
            
            if not plano_contas_id:
                erros.append(f"Lançamento {lanc_data.get('descricao')} sem categoria")
                continue
            
            # Usa data_pagamento se fornecido, senão usa data
            data_pagamento = None
            if lanc_data.get("data_pagamento"):
                data_pagamento = parsear_data(lanc_data["data_pagamento"])
            elif lanc_data.get("data"):
                data_pagamento = parsear_data(lanc_data["data"])
            
            # Usa data_vencimento se fornecido, senão usa data_pagamento ou data
            data_vencimento = None
            if lanc_data.get("data_vencimento"):
                data_vencimento = parsear_data(lanc_data["data_vencimento"])
            elif data_pagamento:
                data_vencimento = data_pagamento
            elif lanc_data.get("data"):
                data_vencimento = parsear_data(lanc_data["data"])
            
            # Garante que ambas as datas estão preenchidas
            if not data_vencimento:
                data_vencimento = data_pagamento or date.today()
            if not data_pagamento:
                data_pagamento = data_vencimento or date.today()
            
            # Para pagamentos do Itaú, sempre são pagos
            status_final = "PAGO"
            
            # Usa valor_pago se fornecido, senão usa valor
            valor_pago = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
            valor_previsto = Decimal(str(lanc_data.get("valor_previsto") or lanc_data["valor"]))
            
            novo_lancamento = Lancamento(
                descricao=lanc_data["descricao"],
                tipo=lanc_data["tipo"],
                status=status_final,
                origem=lanc_data["origem"],
                valor_previsto=valor_previsto,
                valor_pago=valor_pago,
                data_vencimento=data_vencimento,  # ✅ Sempre preenchida
                data_pagamento=data_pagamento,  # ✅ Sempre preenchida
                data_competencia=data_pagamento or data_vencimento or date.today(),
                empresa_id=empresa_id,
                plano_contas_id=plano_contas_id,
                entidade_id=lanc_data.get("entidade_id"),
                conta_id=(conta_resolvida.id if conta_resolvida else lanc_data.get("conta_id") or request.conta_id),
                centro_custo_id=(centro_custo_resolvido or lanc_data.get("centro_custo_id") or request.centro_custo_id),
                import_hash=lanc_data.get("import_hash"),
                conciliado=True,
                ipp=False
            )
            
            db.add(novo_lancamento)
            lancamentos_criados += 1
            
        except Exception as e:
            logger.error(f"Erro ao criar lançamento: {e}")
            erros.append(str(e))
    
    db.commit()
    
    return {
        "sucesso": True,
        "lancamentos_criados": lancamentos_criados,
        "lancamentos_atualizados": lancamentos_atualizados,
        "erros": erros
    }


def _resolver_conta_e_centro(db: Session, empresa_id: int, conta_id: Optional[int]) -> tuple[Conta, int]:
    if not conta_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecione uma conta vinculada ao Itaú para importar."
        )

    conta = db.exec(
        select(Conta).where(
            Conta.id == conta_id,
            Conta.empresa_id == empresa_id
        )
    ).first()

    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    centro_custo_id = conta.centro_custo_id
    if not centro_custo_id:
        centros = db.exec(
            select(CentroCusto.id).where(CentroCusto.empresa_id == empresa_id)
        ).all()
        if len(centros) == 1:
            centro_custo_id = centros[0]
            conta.centro_custo_id = centro_custo_id
            db.add(conta)
            db.commit()
            db.refresh(conta)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conta precisa estar vinculada a um centro de custo."
            )

    return conta, centro_custo_id




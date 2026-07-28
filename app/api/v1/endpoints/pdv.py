# app/api/v1/endpoints/pdv.py
from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlmodel import Session, select, col, or_

from app.api.v1.deps import get_current_active_user, get_empresa_id_from_user
from app.api.deps import check_idempotency
from app.db.session import get_db
from app.enums import PdvPermission
from app.models.lancamento import Lancamento
from app.models.usuario import Usuario
from app.models.produto import Produto
from app.models.plano_contas import PlanoContas
from app.models.empresa import Empresa
from app.models.conta import Conta
from app.models.anexo_lancamento import AnexoLancamento
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.regra_cartao import RegraCartao
from app.models.lote_cartao import LoteCartao
from app.models.lote_cartao_item import LoteCartaoItem
from app.services.periodo_service import PeriodoService
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia
from app.services.compras_service import calcular_novo_custo_medio
from app.schemas.pdv import (
    PdvVendaGrupoRead,
    PdvVendaItemRead,
    PdvVendasRead,
    ProdutoRead,
    ProdutoCreate,
    ProdutoUpdate,
    PdvVendaCreate,
    PdvVendaPagamento,
    RegraCartaoRead,
    RegraCartaoCreate,
    RegraCartaoUpdate,
    LoteCartaoRead,
    LoteCartaoCreate,
    LoteCartaoItemRead,
    PdvConfigSchema,
    PdvIfoodConsolidarIn,
    SangriaCreateSchema
)
from app.models.pdv_ifood_lancamento import PdvIfoodLancamento
from app.schemas.ifood import PdvIfoodLancamentoCreate, PdvIfoodLancamentoRead, PdvIfoodLancamentoUpdate
from app.services.access_control_service import get_effective_permission_codes
from app.services.pdv_service import PdvService, obter_conta_caixa_fisica
from app.core.upload_security import (
    ANEXO_ALLOWED_EXT_TO_MIME,
    UploadValidationError,
    register_upload_rejection,
    register_upload_success,
    write_validated_upload_file,
)

router = APIRouter()

MAX_ANEXO_NOME_LEN = 180
MAX_ANEXO_SIZE = 10 * 1024 * 1024
UPLOAD_ANEXOS_DIR = Path("static/uploads/lancamentos")
UPLOAD_ANEXOS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/vendas", response_model=PdvVendasRead)
def listar_vendas_pdv(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
    limit: int = 200,
):
    from app.models.pdv_venda import PdvVenda
    from app.models.pdv_venda_item import PdvVendaItem
    from app.models.lancamento import Lancamento
    from sqlalchemy.orm import selectinload

    permissions = get_effective_permission_codes(
        db,
        user_id=int(current_user.id or 0),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )
    pode_ver_todas = "*" in permissions or PdvPermission.PDV_VER_TODAS_VENDAS.value in permissions

    query = (
        select(PdvVenda)
        .options(selectinload(PdvVenda.itens), selectinload(PdvVenda.vendedor), selectinload(PdvVenda.cliente))
        .where(
            PdvVenda.empresa_id == empresa_id,
            PdvVenda.is_deleted == False
        )
        .order_by(PdvVenda.data_venda.desc(), PdvVenda.created_at.desc(), PdvVenda.id.desc())
    )

    if not pode_ver_todas:
        query = query.where(PdvVenda.vendedor_id == current_user.id)

    query = query.limit(limit)
    vendas_list = db.exec(query).all()
    has_more = len(vendas_list) >= limit

    # Load associated Lancamentos in one query to read details like payment details
    venda_ids = [v.id for v in vendas_list]
    lancamentos_map = defaultdict(list)
    # Map sale_id -> lock_reconciled boolean
    sale_locks: dict[str, bool] = defaultdict(bool)
    if venda_ids:
        launches = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "PDV",
                Lancamento.id_parcelamento.in_(venda_ids)
            )
        ).all()
        for l in launches:
            lancamentos_map[l.id_parcelamento].append(l)
            if l.conciliado:
                sale_locks[l.id_parcelamento] = True

        grouped_card_launches = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "PDV",
                col(Lancamento.observacao).like('%"grouped_card_launch": true%')
            )
        ).all()
        for g in grouped_card_launches:
            if g.status == "PAGO" and g.conta_id is not None:
                if g.observacao:
                    try:
                        meta = json.loads(g.observacao)
                        contribuicoes = meta.get("contribuicoes", {})
                        for sid in contribuicoes.keys():
                            sale_locks[sid] = True
                    except Exception:
                        pass

    consolidated_items = []
    for v in vendas_list:
        venda_id = v.id
        v_launches = lancamentos_map.get(venda_id, [])
        
        # Load payment details from launches
        pagamentos_list = []
        comprovante_urls = []
        campos_extras = {}
        if v_launches:
            # Sort launches to get consistent first launch metadata
            launches_sorted = sorted(v_launches, key=lambda l: l.id or 0)
            first_l = launches_sorted[0]
            if first_l.observacao:
                try:
                    meta = json.loads(first_l.observacao)
                    pagamentos_list = meta.get("pagamentos", [])
                    comprovante_urls = meta.get("comprovante_urls") or []
                    if meta.get("comprovante_url") and meta.get("comprovante_url") not in comprovante_urls:
                        comprovante_urls.insert(0, meta.get("comprovante_url"))
                    campos_extras = meta.get("campos_extras") or {}
                except Exception:
                    pass
        
        # Format description
        desc_itens = ", ".join(f"{it.nome_customizado or it.produto.nome} x{it.quantidade}" for it in v.itens)
        descricao_completa = desc_itens

        if v.cliente:
            descricao_completa = f"{v.cliente.nome} ({descricao_completa})"

        vendedor_nome = v.vendedor.nome or v.vendedor.email if v.vendedor else "Sem vendedor"
        
        # Determine internal integer ID for sorting/rendering fallback
        # If the venda has associated launches, we can use the first launch ID as the item's numeric ID
        # Otherwise, hash/generate a fallback integer or use the string ID.
        first_launch_id = v_launches[0].id if v_launches else 9999999 + abs(hash(venda_id)) % 10000000

        consolidated_items.append({
            "id": first_launch_id,
            "venda_id_uuid": venda_id,
            "rv": v.rv or f"RV-{first_launch_id:06d}",
            "data": v.data_venda,
            "hora": v.hora_venda[:5] if v.hora_venda else "00:00",
            "vendedor": vendedor_nome,
            "vendedor_id": v.vendedor_id,
            "status": v.status,
            "descricao": descricao_completa,
            "valor": v.valor_total,
            "origem": "PDV",
            "comprovante_url": comprovante_urls[0] if comprovante_urls else None,
            "comprovante_urls": comprovante_urls,
            "entidade_id": v.entidade_id,
            "centro_custo_id": v.centro_custo_id,
            "desconto": v.valor_desconto,
            "observacao_texto": v.observacao,
            "itens_detalhe": [
                {
                    "produto_id": it.produto_id,
                    "nome": it.nome_customizado or it.produto.nome,
                    "quantidade": float(it.quantidade),
                    "preco_unitario": float(it.preco_unitario),
                    "desconto": float(it.desconto),
                    "subtotal": float(it.subtotal)
                }
                for it in v.itens
            ],
            "pagamentos_detalhe": pagamentos_list,
            "campos_extras": campos_extras,
            "is_direct_sale": v.is_direct_sale,
            "lock_reconciled": sale_locks.get(venda_id, False)
        })

    # Sort consolidated sales by date and ID desc
    consolidated_items.sort(key=lambda item: (item["data"], item["id"]), reverse=True)

    # Group by date for the API response
    grouped: dict[date, list[PdvVendaItemRead]] = defaultdict(list)
    totals: dict[date, Decimal] = defaultdict(lambda: Decimal("0.00"))

    for item in consolidated_items:
        dt = item["data"]
        grouped[dt].append(
            PdvVendaItemRead(
                id=item["id"],
                rv=item["rv"],
                data=item["data"],
                hora=item["hora"],
                vendedor=item["vendedor"],
                status=item["status"],
                descricao=item["descricao"],
                valor=item["valor"],
                origem=item["origem"],
                venda_id_uuid=item["venda_id_uuid"],
                comprovante_url=item["comprovante_url"],
                vendedor_id=item["vendedor_id"],
                entidade_id=item["entidade_id"],
                centro_custo_id=item["centro_custo_id"],
                desconto=item["desconto"],
                observacao_texto=item["observacao_texto"],
                itens_detalhe=item["itens_detalhe"],
                pagamentos_detalhe=item["pagamentos_detalhe"],
                campos_extras=item["campos_extras"],
                is_direct_sale=item.get("is_direct_sale", False),
                lock_reconciled=item.get("lock_reconciled", False)
            )
        )
        totals[dt] += item["valor"]

    grupos = [
        PdvVendaGrupoRead(
            data=data,
            total=totals[data],
            quantidade=len(vendas),
            vendas=vendas,
        )
        for data, vendas in sorted(grouped.items(), key=lambda item: item[0], reverse=True)
    ]

    total_valor = sum((grupo.total for grupo in grupos), Decimal("0.00"))
    total_vendas = sum(grupo.quantidade for grupo in grupos)

    return PdvVendasRead(
        pode_ver_todas=pode_ver_todas,
        total_vendas=total_vendas,
        total_valor=total_valor,
        grupos=grupos,
        has_more=has_more,
    )


# --- Rotas para Produtos do PDV ---

@router.get("/produtos", response_model=list[ProdutoRead])
def listar_produtos_pdv(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Retorna a lista de produtos ativos cadastrados para a empresa."""
    from sqlalchemy import func
    
    produtos = db.exec(
        select(Produto)
        .where(Produto.empresa_id == empresa_id, Produto.is_deleted == False)
        .order_by(Produto.nome)
    ).all()
    
    result = []
    for p in produtos:
        estoque_sum = db.exec(
            select(func.sum(MovimentacaoEstoque.quantidade))
            .where(
                MovimentacaoEstoque.produto_id == p.id,
                MovimentacaoEstoque.empresa_id == empresa_id,
                MovimentacaoEstoque.is_deleted == False
            )
        ).one()
        
        p_read = ProdutoRead.model_validate(p)
        p_read.quantidade_estoque = float(estoque_sum or 0.0)
        result.append(p_read)
        
    return result


@router.post("/produtos", response_model=ProdutoRead, status_code=201)
def criar_produto_pdv(
    produto_in: ProdutoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Cadastra um novo produto para a empresa."""
    produto = Produto(
        nome=produto_in.nome,
        preco_unitario=produto_in.preco_unitario,
        tipo=produto_in.tipo,
        codigo_barras=produto_in.codigo_barras,
        imagem_url=produto_in.imagem_url,
        preco_custo_medio=produto_in.preco_custo_medio,
        ncm=produto_in.ncm,
        cest=produto_in.cest,
        cfop_padrao=produto_in.cfop_padrao,
        revisao_pendente=produto_in.revisao_pendente,
        empresa_id=empresa_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(produto)
    db.commit()
    db.refresh(produto)
    
    p_read = ProdutoRead.model_validate(produto)
    p_read.quantidade_estoque = 0.0
    return p_read


@router.put("/produtos/{produto_id}", response_model=ProdutoRead)
def atualizar_produto_pdv(
    produto_id: int,
    produto_in: ProdutoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza as informações de um produto existente."""
    produto = db.get(Produto, produto_id)
    if not produto or produto.empresa_id != empresa_id or produto.is_deleted:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    
    if produto_in.nome is not None:
        produto.nome = produto_in.nome
    if produto_in.preco_unitario is not None:
        produto.preco_unitario = produto_in.preco_unitario
    if produto_in.is_active is not None:
        produto.is_active = produto_in.is_active
    if produto_in.tipo is not None:
        produto.tipo = produto_in.tipo
    if produto_in.codigo_barras is not None:
        produto.codigo_barras = produto_in.codigo_barras
    if produto_in.imagem_url is not None:
        produto.imagem_url = produto_in.imagem_url
    if produto_in.preco_custo_medio is not None:
        produto.preco_custo_medio = produto_in.preco_custo_medio
    if produto_in.ncm is not None:
        produto.ncm = produto_in.ncm
    if produto_in.cest is not None:
        produto.cest = produto_in.cest
    if produto_in.cfop_padrao is not None:
        produto.cfop_padrao = produto_in.cfop_padrao
    if produto_in.revisao_pendente is not None:
        produto.revisao_pendente = produto_in.revisao_pendente
        
    produto.updated_by_id = current_user.id
    produto.updated_at = datetime.utcnow()
    db.add(produto)
    db.commit()
    db.refresh(produto)
    
    from sqlalchemy import func
    estoque_sum = db.exec(
        select(func.sum(MovimentacaoEstoque.quantidade))
        .where(
            MovimentacaoEstoque.produto_id == produto.id,
            MovimentacaoEstoque.empresa_id == empresa_id,
            MovimentacaoEstoque.is_deleted == False
        )
    ).one()
    
    p_read = ProdutoRead.model_validate(produto)
    p_read.quantidade_estoque = float(estoque_sum or 0.0)
    return p_read


@router.delete("/produtos/{produto_id}", status_code=204)
def deletar_produto_pdv(
    produto_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Deleta (exclusão lógica) um produto do PDV."""
    produto = db.get(Produto, produto_id)
    if not produto or produto.empresa_id != empresa_id or produto.is_deleted:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    
    produto.is_deleted = True
    produto.deleted_at = datetime.utcnow()
    produto.deleted_by_id = current_user.id
    db.add(produto)
    db.commit()
    return


def recalculate_product_custo_medio(db: Session, produto_id: int, empresa_id: int) -> float:
    movements = db.exec(
        select(MovimentacaoEstoque)
        .where(
            MovimentacaoEstoque.produto_id == produto_id,
            MovimentacaoEstoque.empresa_id == empresa_id,
            MovimentacaoEstoque.is_deleted == False
        )
        .order_by(MovimentacaoEstoque.created_at, MovimentacaoEstoque.id)
    ).all()

    saldo = 0.0
    custo_medio = 0.0

    for mov in movements:
        if mov.quantidade > 0:
            custo_medio = calcular_novo_custo_medio(
                saldo_atual=saldo,
                custo_medio_atual=custo_medio,
                quantidade_entrada=mov.quantidade,
                valor_entrada=mov.valor_total
            )
        saldo += mov.quantidade
        if saldo < 0:
            saldo = 0.0
            
    return custo_medio


@router.post("/produtos/{id_temporario}/mesclar/{id_existente}")
def mesclar_produtos(
    id_temporario: int,
    id_existente: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Mescla um produto temporário (pendente de revisão) a um produto existente no catálogo.
    Transfere movimentações de estoque, recalcula o custo médio e atualiza equivalências.
    """
    prod_temp = db.get(Produto, id_temporario)
    prod_exist = db.get(Produto, id_existente)
    
    if not prod_temp or prod_temp.empresa_id != empresa_id or prod_temp.is_deleted:
        raise HTTPException(status_code=404, detail="Produto temporário não encontrado.")
    if not prod_exist or prod_exist.empresa_id != empresa_id or prod_exist.is_deleted:
        raise HTTPException(status_code=404, detail="Produto existente não encontrado.")
        
    if id_temporario == id_existente:
        raise HTTPException(status_code=400, detail="Não é possível mesclar um produto com ele mesmo.")
        
    try:
        # 1. Transfer Kardex (MovimentacaoEstoque)
        movs = db.exec(
            select(MovimentacaoEstoque)
            .where(
                MovimentacaoEstoque.produto_id == id_temporario,
                MovimentacaoEstoque.empresa_id == empresa_id,
                MovimentacaoEstoque.is_deleted == False
            )
        ).all()
        for m in movs:
            m.produto_id = id_existente
            m.updated_by_id = current_user.id
            m.updated_at = datetime.utcnow()
            db.add(m)
            
        # Flush to DB so the database sees the updated records for recalculation
        db.flush()
        
        # 2. Recalculate cost price for existing product
        novo_custo = recalculate_product_custo_medio(db, id_existente, empresa_id)
        prod_exist.preco_custo_medio = novo_custo
        prod_exist.updated_by_id = current_user.id
        prod_exist.updated_at = datetime.utcnow()
        db.add(prod_exist)
        
        # 3. Transfer/update supplier equivalences
        equivalencias = db.exec(
            select(FornecedorProdutoEquivalencia)
            .where(
                FornecedorProdutoEquivalencia.produto_interno_id == id_temporario,
                FornecedorProdutoEquivalencia.is_deleted == False
            )
        ).all()
        
        for eq in equivalencias:
            exists = db.exec(
                select(FornecedorProdutoEquivalencia)
                .where(
                    FornecedorProdutoEquivalencia.empresa_id == eq.empresa_id,
                    FornecedorProdutoEquivalencia.fornecedor_id == eq.fornecedor_id,
                    FornecedorProdutoEquivalencia.codigo_produto_fornecedor == eq.codigo_produto_fornecedor,
                    FornecedorProdutoEquivalencia.produto_interno_id == id_existente,
                    FornecedorProdutoEquivalencia.is_deleted == False
                )
            ).first()
            if exists:
                eq.is_deleted = True
                eq.deleted_at = datetime.utcnow()
                eq.deleted_by_id = current_user.id
                db.add(eq)
            else:
                eq.produto_interno_id = id_existente
                eq.updated_by_id = current_user.id
                eq.updated_at = datetime.utcnow()
                db.add(eq)
                
        # 4. Soft delete the temporary product
        prod_temp.is_deleted = True
        prod_temp.is_active = False
        prod_temp.deleted_at = datetime.utcnow()
        prod_temp.deleted_by_id = current_user.id
        db.add(prod_temp)
        
        db.commit()
        db.refresh(prod_exist)
        return {"status": "sucesso", "produto_mesclado": prod_exist}
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao mesclar produtos: {str(e)}"
        )


# --- Rotas para Regras de Cartão do PDV ---

@router.get("/regras-cartao", response_model=list[RegraCartaoRead])
def listar_regras_cartao(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista todas as regras de repasse de cartão cadastradas para a empresa."""
    return db.exec(
        select(RegraCartao)
        .where(RegraCartao.empresa_id == empresa_id, RegraCartao.is_deleted == False)
        .order_by(RegraCartao.tipo_pagamento, RegraCartao.bandeira)
    ).all()


@router.post("/regras-cartao", response_model=RegraCartaoRead, status_code=201)
def criar_regra_cartao(
    regra_in: RegraCartaoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Cria uma nova regra de repasse de cartão."""
    if regra_in.conta_destino_id:
        conta = db.get(Conta, regra_in.conta_destino_id)
        if not conta or conta.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Conta destino inválida.")
            
    if regra_in.plano_contas_taxa_id:
        plano = db.get(PlanoContas, regra_in.plano_contas_taxa_id)
        if not plano or plano.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Plano de contas de taxa inválido.")

    regra = RegraCartao(
        empresa_id=empresa_id,
        tipo_pagamento=regra_in.tipo_pagamento,
        bandeira=regra_in.bandeira.upper(),
        centro_custo_id=regra_in.centro_custo_id,
        taxa_porcentagem=regra_in.taxa_porcentagem,
        dias_payout=regra_in.dias_payout,
        tipo_prazo=regra_in.tipo_prazo,
        dia_fixo=regra_in.dia_fixo,
        fds_proximo_dia_util=regra_in.fds_proximo_dia_util,
        modo_parcelamento=regra_in.modo_parcelamento,
        taxa_antecipacao=regra_in.taxa_antecipacao,
        conta_destino_id=regra_in.conta_destino_id,
        plano_contas_taxa_id=regra_in.plano_contas_taxa_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(regra)
    db.commit()
    db.refresh(regra)
    return regra


@router.put("/regras-cartao/{id}", response_model=RegraCartaoRead)
def atualizar_regra_cartao(
    id: int,
    regra_in: RegraCartaoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza as configurações de uma regra de repasse de cartão existente."""
    regra = db.get(RegraCartao, id)
    if not regra or regra.empresa_id != empresa_id or regra.is_deleted:
        raise HTTPException(status_code=404, detail="Regra de cartão não encontrada.")

    if regra_in.conta_destino_id:
        conta = db.get(Conta, regra_in.conta_destino_id)
        if not conta or conta.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Conta destino inválida.")
            
    if regra_in.plano_contas_taxa_id:
        plano = db.get(PlanoContas, regra_in.plano_contas_taxa_id)
        if not plano or plano.empresa_id != empresa_id:
            raise HTTPException(status_code=400, detail="Plano de contas de taxa inválido.")

    if regra_in.tipo_pagamento is not None:
        regra.tipo_pagamento = regra_in.tipo_pagamento
    if regra_in.bandeira is not None:
        regra.bandeira = regra_in.bandeira.upper()
    if regra_in.centro_custo_id is not None:
        regra.centro_custo_id = regra_in.centro_custo_id
    if regra_in.taxa_porcentagem is not None:
        regra.taxa_porcentagem = regra_in.taxa_porcentagem
    if regra_in.dias_payout is not None:
        regra.dias_payout = regra_in.dias_payout
    if regra_in.tipo_prazo is not None:
        regra.tipo_prazo = regra_in.tipo_prazo
    if regra_in.dia_fixo is not None:
        regra.dia_fixo = regra_in.dia_fixo
    if regra_in.fds_proximo_dia_util is not None:
        regra.fds_proximo_dia_util = regra_in.fds_proximo_dia_util
    if regra_in.modo_parcelamento is not None:
        regra.modo_parcelamento = regra_in.modo_parcelamento
    if regra_in.taxa_antecipacao is not None:
        regra.taxa_antecipacao = regra_in.taxa_antecipacao
    if regra_in.conta_destino_id is not None:
        regra.conta_destino_id = regra_in.conta_destino_id
    if regra_in.plano_contas_taxa_id is not None:
        regra.plano_contas_taxa_id = regra_in.plano_contas_taxa_id

    regra.updated_by_id = current_user.id
    regra.updated_at = datetime.utcnow()
    db.add(regra)
    db.commit()
    db.refresh(regra)
    return regra


@router.delete("/regras-cartao/{id}", status_code=204)
def deletar_regra_cartao(
    id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Deleta (exclusão lógica) uma regra de repasse de cartão."""
    regra = db.get(RegraCartao, id)
    if not regra or regra.empresa_id != empresa_id or regra.is_deleted:
        raise HTTPException(status_code=404, detail="Regra de cartão não encontrada.")

    regra.is_deleted = True
    regra.deleted_at = datetime.utcnow()
    regra.deleted_by_id = current_user.id
    db.add(regra)
    db.commit()
    return



# --- Rota para Criar Venda Itemizada no PDV ---

@router.post("/vendas", response_model=PdvVendaItemRead, status_code=201)
def criar_venda_pdv(
    venda_in: PdvVendaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
    idempotency_key: Optional[str] = Depends(check_idempotency),
):
    """Registra uma nova venda itemizada no PDV, criando os respectivos lançamentos financeiros."""
    permissions = get_effective_permission_codes(
        db,
        user_id=int(current_user.id or 0),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )
    pode_escolher_vendedor = "*" in permissions or "PDV_REALIZAR_SANGRIA" in permissions or "PDV_CANCELAR_VENDA" in permissions
    if not pode_escolher_vendedor and venda_in.vendedor_id != current_user.id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para indicar outro vendedor.")

    response_data = PdvService.criar_venda(
        db=db,
        venda_in=venda_in,
        empresa_id=empresa_id,
        current_user_id=int(current_user.id or 0)
    )

    if idempotency_key:
        from fastapi.encoders import jsonable_encoder
        from app.models.idempotency_log import IdempotencyLog
        log = db.exec(select(IdempotencyLog).where(IdempotencyLog.idempotency_key == idempotency_key)).first()
        if log:
            log.status = "completed"
            log.response_body = jsonable_encoder(response_data)
            log.updated_at = datetime.utcnow()
            db.add(log)
            db.commit()

    return response_data

@router.put("/vendas/{venda_id}", response_model=PdvVendaItemRead)
def atualizar_venda_pdv(
    venda_id: str,
    venda_in: PdvVendaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza uma venda existente substituindo seus lançamentos pelos novos informados."""
    from app.models.pdv_venda import PdvVenda
    venda = db.exec(
        select(PdvVenda).where(
            PdvVenda.id == venda_id,
            PdvVenda.empresa_id == empresa_id
        )
    ).first()
    if not venda:
        raise HTTPException(status_code=404, detail="Venda não encontrada.")

    permissions = get_effective_permission_codes(
        db,
        user_id=int(current_user.id or 0),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )
    pode_ver_todas = "*" in permissions or PdvPermission.PDV_VER_TODAS_VENDAS.value in permissions
    if not pode_ver_todas and venda.vendedor_id != current_user.id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para editar vendas de outros vendedores.")

    result = PdvService.atualizar_venda(
        db=db,
        venda_id=venda_id,
        venda_in=venda_in,
        empresa_id=empresa_id,
        current_user_id=int(current_user.id or 0)
    )
    db.commit()
    return result

@router.patch("/vendas/{venda_id}/status", status_code=200)
def atualizar_status_venda_pdv(
    venda_id: str,
    status_in: str = Query(..., description="Novo status da venda: REALIZADO, CANCELADO, DEVOLVIDO"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza o status de todos os lançamentos que compartilham o mesmo UUID de venda."""
    novo_status = status_in.upper()
    if novo_status not in ["REALIZADO", "CANCELADO", "DEVOLVIDO"]:
        raise HTTPException(status_code=400, detail="Status inválido.")

    if novo_status in ["CANCELADO", "DEVOLVIDO"]:
        permissions = get_effective_permission_codes(
            db,
            user_id=int(current_user.id or 0),
            empresa_id=int(empresa_id),
            is_consultor=bool(current_user.is_consultor),
            consultor_role=str(current_user.consultor_role or ""),
        )
        if "*" not in permissions and PdvPermission.PDV_CANCELAR_VENDA.value not in permissions:
            raise HTTPException(status_code=403, detail="Você não tem permissão para cancelar ou devolver vendas.")

    PdvService.atualizar_status_contribuicoes_venda(
        db=db,
        empresa_id=empresa_id,
        venda_id=venda_id,
        novo_status=novo_status,
        current_user_id=int(current_user.id or 0)
    )

    # Sincronizar estoque e lançamentos splits
    PdvService.sincronizar_status_estoque_e_splits(
        db, empresa_id, venda_id, novo_status, int(current_user.id or 0)
    )

    # Sincronizar status com a tabela operacional PdvVenda
    venda_op = db.get(PdvVenda, venda_id)
    if venda_op:
        venda_op.status = novo_status
        venda_op.updated_by_id = current_user.id
        venda_op.updated_at = datetime.utcnow()
        db.add(venda_op)

    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id, force=True)

    db.commit()
    return {"message": f"Status da venda atualizado para {novo_status} com sucesso."}


# --- Rota para Anexar Comprovante no PDV ---

@router.post("/vendas/{venda_id}/comprovante", status_code=200)
def upload_comprovante_venda_pdv(
    venda_id: str,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Faz o upload de um ou mais comprovantes e os associa a todos os lançamentos daquela venda no PDV."""
    launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            Lancamento.id_parcelamento == venda_id
        )
    ).all()
    if not launches:
        raise HTTPException(status_code=404, detail="Venda não encontrada.")

    uploaded_urls = []
    for file in files:
        if not file.filename:
            continue
        nome_arquivo = Path(file.filename).name.strip()
        if len(nome_arquivo) > MAX_ANEXO_NOME_LEN:
            raise HTTPException(status_code=400, detail=f"Nome do arquivo '{nome_arquivo}' excede o limite.")

        # Pasta destino usando o ID do primeiro lançamento para consistência
        first_launch_id = launches[0].id
        destino_dir = UPLOAD_ANEXOS_DIR / str(empresa_id) / str(first_launch_id)
        destino_dir.mkdir(parents=True, exist_ok=True)
        ext = Path(nome_arquivo).suffix.lower()[:12]
        nome_storage = f"{uuid.uuid4().hex}{ext}"
        destino_arquivo = destino_dir / nome_storage

        try:
            _, tamanho_bytes, content_type = write_validated_upload_file(
                upload=file,
                destination=destino_arquivo,
                max_size=MAX_ANEXO_SIZE,
                allowed_ext_to_mime=ANEXO_ALLOWED_EXT_TO_MIME,
                max_filename_len=MAX_ANEXO_NOME_LEN,
            )
        except UploadValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message)

        url_relativa = f"/static/uploads/lancamentos/{empresa_id}/{first_launch_id}/{nome_storage}"
        uploaded_urls.append((nome_arquivo, url_relativa, tamanho_bytes, content_type))

    if not uploaded_urls:
        raise HTTPException(status_code=400, detail="Nenhum arquivo válido enviado.")

    # Associar e atualizar registros de anexos e metadados
    for l in launches:
        meta = {}
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
            except Exception:
                pass
        
        comprovante_urls = meta.get("comprovante_urls") or []
        if meta.get("comprovante_url") and meta.get("comprovante_url") not in comprovante_urls:
            comprovante_urls.insert(0, meta.get("comprovante_url"))

        for nome_arquivo, url_relativa, tamanho_bytes, content_type in uploaded_urls:
            anexo = AnexoLancamento(
                nome_arquivo=nome_arquivo,
                url=url_relativa,
                tipo="COMPROVANTE",
                tamanho_bytes=tamanho_bytes,
                content_type=content_type,
                lancamento_id=l.id,
                empresa_id=empresa_id,
                created_by_id=current_user.id,
                updated_by_id=current_user.id
            )
            db.add(anexo)

            if url_relativa not in comprovante_urls:
                comprovante_urls.append(url_relativa)

        meta["comprovante_urls"] = comprovante_urls
        meta["comprovante_url"] = comprovante_urls[0] if comprovante_urls else None
        l.observacao = json.dumps(meta)
        db.add(l)

    db.commit()
    return {"message": "Comprovantes anexados com sucesso.", "urls": [u[1] for u in uploaded_urls]}


@router.get("/recebiveis", status_code=200)
def listar_recebiveis_cartao(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
):
    """Lista recebíveis de cartão previstos/recebidos da empresa (Agenda de Recebíveis).
    
    Lê da tabela pdv_movimentacoes e também da tabela lancamentos (para lançamentos agrupados de cartão).
    """
    from app.services.pdv_service import obter_regra_cartao
    from sqlalchemy.orm import selectinload
    from sqlmodel import col, func

    # 1. Query pdv_movimentacoes joining with PdvVenda, Usuario, and Entidade
    query = (
        select(PdvMovimentacao, PdvVenda, Usuario, Entidade)
        .join(PdvVenda, PdvVenda.id == PdvMovimentacao.venda_id, isouter=True)
        .join(Usuario, Usuario.id == PdvVenda.vendedor_id, isouter=True)
        .join(Entidade, Entidade.id == PdvVenda.entidade_id, isouter=True)
        .where(
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False,
            PdvMovimentacao.forma_pagamento.in_(["CREDITO_AVISTA", "CREDITO_PARCELADO", "DEBITO"])
        )
        .order_by(PdvMovimentacao.data.desc(), PdvMovimentacao.id.desc())
    )
    if start_date:
        query = query.where(PdvMovimentacao.data >= start_date)
    if end_date:
        query = query.where(PdvMovimentacao.data <= end_date)

    rows = db.exec(query).all()

    # Prefetch items for performance (avoiding N+1 queries)
    venda_ids = [m.venda_id for m, *_ in rows if m.venda_id]
    items_map = {}
    if venda_ids:
        venda_items = db.exec(
            select(PdvVendaItem)
            .options(selectinload(PdvVendaItem.produto))
            .where(PdvVendaItem.venda_id.in_(venda_ids))
        ).all()
        for vi in venda_items:
            items_map.setdefault(vi.venda_id, []).append({
                "produto_id": vi.produto_id,
                "nome": vi.nome_customizado or (vi.produto.nome if vi.produto else "Produto"),
                "quantidade": float(vi.quantidade),
                "preco_unitario": float(vi.preco_unitario),
                "desconto": float(vi.desconto or 0),
                "subtotal": float(vi.subtotal)
            })

    recebiveis = []
    for m, venda, vendedor, cliente in rows:
        tipo_pag_lower = "cartao_debito" if m.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if m.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")

        regra = obter_regra_cartao(db, empresa_id, tipo_pag_lower, m.bandeira, m.centro_custo_id)
        if regra:
            if regra.modo_parcelamento == "ANTECIPADO":
                fee_percentage = regra.taxa_porcentagem + (m.numero_parcela - 1) * regra.taxa_antecipacao
            else:
                fee_percentage = regra.taxa_porcentagem
        else:
            fee_percentage = Decimal("0.00")

        valor_bruto = m.valor
        valor_taxa = (valor_bruto * fee_percentage / 100).quantize(Decimal("0.01"))
        valor_liquido = valor_bruto - valor_taxa

        status_l = "PAGO" if m.conciliado else "A RECEBER"

        recebiveis.append({
            "id": m.id,
            "venda_id_uuid": m.venda_id,
            "rv": venda.rv if (venda and venda.rv) else f"RV-{m.id:06d}",
            "data_venda": venda.data_venda if venda else m.data,
            "data_vencimento": m.data,
            "descricao": m.descricao,
            "tipo_pagamento": tipo_pag_lower,
            "bandeira": m.bandeira or "OUTROS",
            "numero_parcela": m.numero_parcela,
            "total_parcelas": m.parcelas,
            "valor_bruto": valor_bruto,
            "valor_taxa": valor_taxa,
            "valor_liquido": valor_liquido,
            "status": status_l,
            "vendedor": (vendedor.nome or vendedor.email) if vendedor else "Sem vendedor",
            "vendedor_id": venda.vendedor_id if venda else None,
            "cliente": (cliente.nome or cliente.nome_fantasia or "Cliente Final") if cliente else "Cliente Final",
            "cliente_id": venda.entidade_id if venda else None,
            "itens": items_map.get(m.venda_id, []) if m.venda_id else [],
            "conta_id": m.conta_id,
            "plano_contas_id": None
        })

    # 2. Query Lancamento para Lançamentos Agrupados de Cartão (grouped_card_launch)
    query_grouped = (
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA",
            col(Lancamento.observacao).like('%"grouped_card_launch": true%')
        )
    )
    if start_date:
        query_grouped = query_grouped.where(func.coalesce(Lancamento.data_vencimento, Lancamento.data_pagamento) >= start_date)
    if end_date:
        query_grouped = query_grouped.where(func.coalesce(Lancamento.data_vencimento, Lancamento.data_pagamento) <= end_date)

    grouped_launches = db.exec(query_grouped).all()
    for gl in grouped_launches:
        dt_venc = gl.data_vencimento or gl.data_pagamento or date.today()
        dt_comp = gl.data_competencia or dt_venc
        
        bandeira_gl = "OUTROS"
        modalidade_gl = "cartao_credito_vista"
        try:
            if gl.observacao:
                parsed_meta = json.loads(gl.observacao)
                bandeira_gl = parsed_meta.get("bandeira", "OUTROS")
                mod = parsed_meta.get("modalidade", "CREDITO")
                mod_str = str(mod).upper()
                if "PARCELADO" in mod_str:
                    modalidade_gl = "cartao_credito_parcelado"
                elif "DEBITO" in mod_str or "DEBIT" in mod_str:
                    modalidade_gl = "cartao_debito"
                else:
                    modalidade_gl = "cartao_credito_vista"
        except Exception:
            pass

        val_bruto_gl = gl.valor_previsto or Decimal("0.00")

        regra_gl = obter_regra_cartao(db, empresa_id, modalidade_gl, bandeira_gl, gl.centro_custo_id)
        if regra_gl:
            fee_percentage_gl = regra_gl.taxa_porcentagem
        else:
            fee_percentage_gl = Decimal("0.00")

        val_taxa_gl = (val_bruto_gl * fee_percentage_gl / Decimal("100")).quantize(Decimal("0.01"))
        
        val_pago_gl = gl.valor_pago or Decimal("0.00")
        if gl.status == "PAGO" and val_pago_gl > 0:
            val_liquido_gl = val_pago_gl
        else:
            val_liquido_gl = val_bruto_gl - val_taxa_gl

        status_gl = "PAGO" if gl.status == "PAGO" else "A RECEBER"

        recebiveis.append({
            "id": gl.id,
            "venda_id_uuid": f"GROUPED-{gl.id}",
            "rv": f"RV-GRP-{gl.id:06d}",
            "data_venda": dt_comp,
            "data_vencimento": dt_venc,
            "descricao": gl.descricao or f"Recebimento Agrupado {bandeira_gl}",
            "tipo_pagamento": modalidade_gl,
            "bandeira": bandeira_gl,
            "numero_parcela": 1,
            "total_parcelas": 1,
            "valor_bruto": val_bruto_gl,
            "valor_taxa": val_taxa_gl,
            "valor_liquido": val_liquido_gl,
            "status": status_gl,
            "vendedor": "Lote Agrupado",
            "vendedor_id": None,
            "cliente": "Recebimento Cartões",
            "cliente_id": None,
            "itens": [],
            "conta_id": gl.conta_id,
            "plano_contas_id": gl.plano_contas_id
        })

    return recebiveis


from pydantic import BaseModel

class AtualizarRecebivelSchema(BaseModel):
    bandeira: Optional[str] = None
    valor: Optional[Decimal] = None

@router.put("/recebiveis/{id}", status_code=200)
def atualizar_recebivel_cartao(
    id: int,
    payload: AtualizarRecebivelSchema,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Atualiza bandeira ou valor de um recebível de cartão (PdvMovimentacao ou Lancamento Agrupado).
    Recalcula taxa, valor líquido e atualiza o lançamento financeiro em Contas a Receber.
    Bloqueia se já estiver PAGO/CONCILIADO em uma conta bancária.
    """
    from app.services.pdv_service import obter_regra_cartao
    
    # 1. Tentar encontrar PdvMovimentacao por id
    m_op = db.get(PdvMovimentacao, id)
    if m_op and m_op.empresa_id == empresa_id and not m_op.is_deleted:
        if m_op.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Este recebível já foi conciliado e creditado na conta bancária. Para alterar bandeira ou valor, desfaça a conciliação do lote primeiro."
            )
        
        # Verificar lançamentos financeiros vinculados
        if m_op.venda_id:
            l_list = db.exec(
                select(Lancamento).where(
                    Lancamento.empresa_id == empresa_id,
                    Lancamento.id_parcelamento == m_op.venda_id,
                    Lancamento.is_deleted == False
                )
            ).all()
        else:
            l_item = db.get(Lancamento, m_op.id)
            l_list = [l_item] if l_item else []
            
        for l in l_list:
            if l.status == "PAGO" and l.conta_id is not None:
                conta = db.get(Conta, l.conta_id)
                nome_c = conta.nome if conta else "Banco"
                raise HTTPException(
                    status_code=400,
                    detail=f"Este recebível já foi pago/baixado no banco '{nome_c}'. Não é possível alterar a bandeira ou valor."
                )

        if payload.bandeira:
            m_op.bandeira = payload.bandeira.upper()
        if payload.valor is not None and payload.valor > 0:
            m_op.valor = payload.valor

        m_op.updated_at = datetime.utcnow()
        m_op.updated_by_id = current_user.id
        db.add(m_op)

        # Recalcular taxa e valor líquido
        tipo_pag_lower = "cartao_debito" if m_op.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if m_op.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")
        regra = obter_regra_cartao(db, empresa_id, tipo_pag_lower, m_op.bandeira, m_op.centro_custo_id)
        fee_pct = regra.taxa_porcentagem if regra else Decimal("0.00")
        valor_taxa = (m_op.valor * fee_pct / Decimal("100")).quantize(Decimal("0.01"))
        valor_liquido = m_op.valor - valor_taxa

        for l in l_list:
            l.valor_previsto = valor_liquido
            meta = {}
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    meta = {}
            meta["bandeira"] = m_op.bandeira
            meta["valor_bruto"] = float(m_op.valor)
            meta["valor_taxa"] = float(valor_taxa)
            meta["valor_liquido"] = float(valor_liquido)
            l.observacao = json.dumps(meta)
            l.updated_at = datetime.utcnow()
            l.updated_by_id = current_user.id
            db.add(l)

        db.commit()
        return {"status": "success", "message": "Recebível atualizado com sucesso."}

    # 2. Tentar encontrar Lancamento Agrupado por id
    gl = db.get(Lancamento, id)
    if gl and gl.empresa_id == empresa_id and not gl.is_deleted:
        if gl.status == "PAGO" and gl.conta_id is not None:
            conta = db.get(Conta, gl.conta_id)
            nome_c = conta.nome if conta else "Banco"
            raise HTTPException(
                status_code=400,
                detail=f"Este recebível agrupado já foi pago/baixado no banco '{nome_c}'. Não é possível alterar a bandeira ou valor."
            )

        meta = {}
        if gl.observacao:
            try:
                meta = json.loads(gl.observacao)
            except Exception:
                meta = {}
        
        bandeira_gl = payload.bandeira.upper() if payload.bandeira else meta.get("bandeira", "OUTROS")
        meta["bandeira"] = bandeira_gl
        
        if payload.valor is not None and payload.valor > 0:
            val_bruto_gl = payload.valor
        else:
            val_bruto_gl = gl.valor_previsto or Decimal("0.00")

        mod = meta.get("modalidade", "CREDITO")
        mod_str = str(mod).upper()
        if "PARCELADO" in mod_str:
            modalidade_gl = "cartao_credito_parcelado"
        elif "DEBITO" in mod_str or "DEBIT" in mod_str:
            modalidade_gl = "cartao_debito"
        else:
            modalidade_gl = "cartao_credito_vista"

        regra = obter_regra_cartao(db, empresa_id, modalidade_gl, bandeira_gl, gl.centro_custo_id)
        fee_pct = regra.taxa_porcentagem if regra else Decimal("0.00")
        val_taxa_gl = (val_bruto_gl * fee_pct / Decimal("100")).quantize(Decimal("0.01"))
        val_liquido_gl = val_bruto_gl - val_taxa_gl

        gl.valor_previsto = val_liquido_gl
        meta["valor_bruto"] = float(val_bruto_gl)
        meta["valor_taxa"] = float(val_taxa_gl)
        meta["valor_liquido"] = float(val_liquido_gl)
        gl.observacao = json.dumps(meta)
        gl.updated_at = datetime.utcnow()
        gl.updated_by_id = current_user.id
        db.add(gl)
        db.commit()
        return {"status": "success", "message": "Recebível agrupado atualizado com sucesso."}

    raise HTTPException(status_code=404, detail="Recebível não encontrado.")


@router.post("/conciliacao/auto-match", status_code=200)
def auto_match_conciliacao(
    lancamento_deposito_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Retorna sugestões de recebíveis que correspondem ao valor creditado no extrato."""
    from datetime import timedelta

    deposito = db.get(Lancamento, lancamento_deposito_id)
    if not deposito or deposito.empresa_id != empresa_id or deposito.is_deleted:
        raise HTTPException(status_code=404, detail="Lançamento de depósito não encontrado.")
    
    valor_deposito = deposito.valor_pago if deposito.valor_pago > 0 else deposito.valor_previsto
    if not valor_deposito or valor_deposito <= 0:
        raise HTTPException(status_code=400, detail="Lançamento de depósito tem valor zerado ou inválido.")
         
    data_deposito = deposito.data_pagamento or deposito.data_vencimento
    if not data_deposito:
        data_deposito = deposito.created_at.date() if deposito.created_at else date.today()

    movs = db.exec(
        select(PdvMovimentacao)
        .where(
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False,
            PdvMovimentacao.forma_pagamento.in_(["CREDITO_AVISTA", "CREDITO_PARCELADO", "DEBITO"]),
            PdvMovimentacao.conciliado == False,
            PdvMovimentacao.data >= data_deposito - timedelta(days=7),
            PdvMovimentacao.data <= data_deposito + timedelta(days=7)
        )
    ).all()
    
    # Carrega todas as regras de cartão da empresa uma única vez
    regras = db.exec(
        select(RegraCartao)
        .where(
            RegraCartao.empresa_id == empresa_id,
            RegraCartao.is_deleted == False
        )
    ).all()

    def achar_regra_em_memoria(tipo_pag: str, band: str, cc_id: Optional[int]) -> Optional[RegraCartao]:
        band_upper = band.upper() if band else "OUTROS"
        
        # 1. Tentar correspondência exata: tipo, bandeira e centro de custo
        if cc_id:
            for r in regras:
                if r.tipo_pagamento == tipo_pag and r.bandeira == band_upper and r.centro_custo_id == cc_id:
                    return r
                    
        # 2. Tentar tipo e bandeira, sem centro de custo (centro_custo_id = None)
        for r in regras:
            if r.tipo_pagamento == tipo_pag and r.bandeira == band_upper and r.centro_custo_id is None:
                return r
                
        # 3. Tentar tipo e bandeira "OUTROS" com centro de custo
        if cc_id and band_upper != "OUTROS":
            for r in regras:
                if r.tipo_pagamento == tipo_pag and r.bandeira == "OUTROS" and r.centro_custo_id == cc_id:
                    return r
                    
        # 4. Tentar tipo e bandeira "OUTROS" sem centro de custo
        if band_upper != "OUTROS":
            for r in regras:
                if r.tipo_pagamento == tipo_pag and r.bandeira == "OUTROS" and r.centro_custo_id is None:
                    return r
                    
        return None

    recebiveis_abertos = []
    for m in movs:
        tipo_pag_lower = "cartao_debito" if m.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if m.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")
        regra = achar_regra_em_memoria(tipo_pag_lower, m.bandeira, m.centro_custo_id)
        if regra:
            if regra.modo_parcelamento == "ANTECIPADO":
                fee_percentage = regra.taxa_porcentagem + (m.numero_parcela - 1) * regra.taxa_antecipacao
            else:
                fee_percentage = regra.taxa_porcentagem
        else:
            fee_percentage = Decimal("0.00")

        valor_bruto = m.valor
        valor_taxa = (valor_bruto * fee_percentage / 100).quantize(Decimal("0.01"))
        valor_liquido = valor_bruto - valor_taxa
        
        recebiveis_abertos.append({
            "id": m.id,
            "data_vencimento": m.data,
            "bandeira": m.bandeira or "OUTROS",
            "valor_bruto": valor_bruto,
            "valor_taxa": valor_taxa,
            "valor_liquido": valor_liquido,
            "descricao": m.descricao,
            "numero_parcela": m.numero_parcela,
            "total_parcelas": m.parcelas
        })

    suggestions = []
    
    # 1. Sugestões de Lote (agrupamento por data de vencimento e bandeira)
    grupos = defaultdict(list)
    for r in recebiveis_abertos:
        key = (r["data_vencimento"], r["bandeira"])
        grupos[key].append(r)
        
    for (dt, band), itens in grupos.items():
        total_liquido = sum(i["valor_liquido"] for i in itens)
        total_bruto = sum(i["valor_bruto"] for i in itens)
        total_taxa = sum(i["valor_taxa"] for i in itens)
        
        diff_dias = abs((dt - data_deposito).days)
        diff_valor = abs(total_liquido - valor_deposito)
        
        if diff_valor < Decimal("0.10") and diff_dias <= 7:
            score = 100 - (diff_dias * 5) - int(diff_valor * 100)
            score = max(0, min(100, score))
            suggestions.append({
                "tipo": "GRUPO_DIA_BANDEIRA",
                "label": f"Lote de {band} previsto para {dt.strftime('%d/%m/%Y')}",
                "score": score,
                "valor_bruto": total_bruto,
                "valor_taxa": total_taxa,
                "valor_liquido": total_liquido,
                "lancamentos": [i["id"] for i in itens],
                "detalhes": f"{len(itens)} venda(s) de {band} em {dt.strftime('%d/%m')}"
            })

    # 2. Sugestões de Recebível Individual (avulso)
    for r in recebiveis_abertos:
        diff_dias = abs((r["data_vencimento"] - data_deposito).days)
        diff_valor = abs(r["valor_liquido"] - valor_deposito)
        
        if diff_valor < Decimal("0.10") and diff_dias <= 7:
            score = 95 - (diff_dias * 5) - int(diff_valor * 100)
            score = max(0, min(95, score))
            suggestions.append({
                "tipo": "AVULSO",
                "label": f"Venda individual {r['descricao']} - {r['bandeira']}",
                "score": score,
                "valor_bruto": r["valor_bruto"],
                "valor_taxa": r["valor_taxa"],
                "valor_liquido": r["valor_liquido"],
                "lancamentos": [r["id"]],
                "detalhes": f"Venda prevista para {r['data_vencimento'].strftime('%d/%m/%Y')}"
            })

    # 3. Sugestões de Combinação de Recebíveis
    # Agrupar por data de vencimento para ver se há itens na mesma data
    grupos_por_data = defaultdict(list)
    for r in recebiveis_abertos:
        grupos_por_data[r["data_vencimento"]].append(r)

    for dt, itens in grupos_por_data.items():
        if len(itens) > 1 and len(itens) <= 6:
            from itertools import combinations
            for k in range(2, min(4, len(itens) + 1)):
                for comb in combinations(itens, k):
                    total_liquido = sum(c["valor_liquido"] for c in comb)
                    total_bruto = sum(c["valor_bruto"] for c in comb)
                    total_taxa = sum(c["valor_taxa"] for c in comb)
                    
                    diff_dias = abs((dt - data_deposito).days)
                    diff_valor = abs(total_liquido - valor_deposito)
                    
                    if diff_valor < Decimal("0.10") and diff_dias <= 7:
                        score = 90 - (diff_dias * 5) - int(diff_valor * 100)
                        score = max(0, min(90, score))
                        suggestions.append({
                            "tipo": "COMBINACAO",
                            "label": f"Combinação de {k} vendas previstas para {dt.strftime('%d/%m/%Y')}",
                            "score": score,
                            "valor_bruto": total_bruto,
                            "valor_taxa": total_taxa,
                            "valor_liquido": total_liquido,
                            "lancamentos": [c["id"] for c in comb],
                            "detalhes": f"{k} vendas previstas para {dt.strftime('%d/%m')}"
                        })

    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions


@router.post("/conciliacao/lotes", response_model=LoteCartaoRead, status_code=201)
def criar_e_conciliar_lote_cartao(
    lote_in: LoteCartaoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Cria o lote de cartão, liquida as pdv_movimentacoes e lança o faturamento split (bruto e taxa)."""
    from app.services.pdv_service import (
        obter_categoria_receita_pdv,
        obter_categoria_taxas_cartao
    )

    if not lote_in.lancamento_ids:
        raise HTTPException(status_code=400, detail="Nenhum recebível informado para conciliação.")

    if len(lote_in.lancamento_ids) > 500:
        raise HTTPException(status_code=400, detail="Limite máximo de 500 recebíveis por conciliação de lote excedido.")

    # 1. Carregar e validar recebíveis do PDV
    recebiveis = db.exec(
        select(PdvMovimentacao)
        .where(
            PdvMovimentacao.id.in_(lote_in.lancamento_ids),
            PdvMovimentacao.empresa_id == empresa_id,
            PdvMovimentacao.is_deleted == False
        )
    ).all()

    if len(recebiveis) != len(lote_in.lancamento_ids):
        raise HTTPException(status_code=400, detail="Um ou mais recebíveis informados são inválidos ou não pertencem à empresa.")

    for r in recebiveis:
        if r.conciliado:
            raise HTTPException(status_code=400, detail=f"Recebível ID {r.id} já está conciliado.")

    # 2. Validar conta destino
    conta = db.get(Conta, lote_in.conta_destino_id)
    if not conta or conta.empresa_id != empresa_id:
        raise HTTPException(status_code=400, detail="Conta destino inválida.")

    # Carrega todas as regras de cartão da empresa uma única vez
    regras = db.exec(
        select(RegraCartao)
        .where(
            RegraCartao.empresa_id == empresa_id,
            RegraCartao.is_deleted == False
        )
    ).all()

    def achar_regra_em_memoria(tipo_pag: str, band: str, cc_id: Optional[int]) -> Optional[RegraCartao]:
        band_upper = band.upper() if band else "OUTROS"
        
        # 1. Tentar correspondência exata: tipo, bandeira e centro de custo
        if cc_id:
            for r in regras:
                if r.tipo_pagamento == tipo_pag and r.bandeira == band_upper and r.centro_custo_id == cc_id:
                    return r
                    
        # 2. Tentar tipo e bandeira, sem centro de custo (centro_custo_id = None)
        for r in regras:
            if r.tipo_pagamento == tipo_pag and r.bandeira == band_upper and r.centro_custo_id is None:
                return r
                
        # 3. Tentar tipo e bandeira "OUTROS" com centro de custo
        if cc_id and band_upper != "OUTROS":
            for r in regras:
                if r.tipo_pagamento == tipo_pag and r.bandeira == "OUTROS" and r.centro_custo_id == cc_id:
                    return r
                    
        # 4. Tentar tipo e bandeira "OUTROS" sem centro de custo
        if band_upper != "OUTROS":
            for r in regras:
                if r.tipo_pagamento == tipo_pag and r.bandeira == "OUTROS" and r.centro_custo_id is None:
                    return r
                    
        return None

    # 3. Calcular somas
    total_bruto = Decimal("0.00")
    total_taxa = Decimal("0.00")
    total_liquido = Decimal("0.00")

    for r in recebiveis:
        total_bruto += r.valor
        tipo_pag_lower = "cartao_debito" if r.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if r.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")
        
        regra_item = achar_regra_em_memoria(tipo_pag_lower, r.bandeira, r.centro_custo_id)
        if regra_item:
            if regra_item.modo_parcelamento == "ANTECIPADO":
                fee_percentage = regra_item.taxa_porcentagem + (r.numero_parcela - 1) * regra_item.taxa_antecipacao
            else:
                fee_percentage = regra_item.taxa_porcentagem
        else:
            fee_percentage = Decimal("0.00")

        taxa_valor = (r.valor * fee_percentage / 100).quantize(Decimal("0.01"))
        total_taxa += taxa_valor
        total_liquido += (r.valor - taxa_valor)

    # 4. Criar o LoteCartao
    lote = LoteCartao(
        empresa_id=empresa_id,
        data_pagamento=lote_in.data_pagamento,
        valor_bruto=total_bruto,
        valor_taxa=total_taxa,
        valor_liquido=total_liquido,
        conta_destino_id=lote_in.conta_destino_id,
        lancamento_deposito_id=lote_in.lancamento_deposito_id,
        status="CONCILIADO",
        created_by_id=current_user.id,
        updated_by_id=current_user.id
    )
    db.add(lote)
    db.flush()

    # 5. Criar itens do lote e liquidar as pdv_movimentacoes
    for r in recebiveis:
        tipo_pag_lower = "cartao_debito" if r.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if r.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")
        regra_item = achar_regra_em_memoria(tipo_pag_lower, r.bandeira, r.centro_custo_id)
        if regra_item:
            if regra_item.modo_parcelamento == "ANTECIPADO":
                fee_percentage = regra_item.taxa_porcentagem + (r.numero_parcela - 1) * regra_item.taxa_antecipacao
            else:
                fee_percentage = regra_item.taxa_porcentagem
        else:
            fee_percentage = Decimal("0.00")
        taxa_valor = (r.valor * fee_percentage / 100).quantize(Decimal("0.01"))

        item = LoteCartaoItem(
            lote_cartao_id=lote.id,
            pdv_movimentacao_id=r.id,
            valor_bruto=r.valor,
            valor_taxa=taxa_valor,
            valor_liquido=r.valor - taxa_valor
        )
        db.add(item)

        # Atualizar recebível como conciliado
        r.conciliado = True
        r.conta_id = lote_in.conta_destino_id
        r.updated_by_id = current_user.id
        r.updated_at = datetime.utcnow()
        db.add(r)

    # 6. Gravar lançamentos de Split no Financeiro (DRE Fiel)
    plano_receita_id = obter_categoria_receita_pdv(db, empresa_id)
    faturamento_bruto = Lancamento(
        descricao=f"Faturamento Bruto Cartão - Lote #{lote.id}",
        tipo="RECEITA",
        status="PAGO",
        origem="PDV",
        valor_previsto=total_bruto,
        valor_pago=total_bruto,
        valor_juros=Decimal("0.00"),
        valor_desconto=Decimal("0.00"),
        valor_multa=Decimal("0.00"),
        data_vencimento=lote_in.data_pagamento,
        data_pagamento=lote_in.data_pagamento,
        data_competencia=lote_in.data_pagamento,
        competencia=lote_in.data_pagamento.strftime("%m-%Y"),
        empresa_id=empresa_id,
        plano_contas_id=plano_receita_id,
        conta_id=lote_in.conta_destino_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
        observacao=json.dumps({"lote_cartao_id": lote.id, "conciliacao_faturamento": True}),
        is_deleted=False,
        ipp=False,
        previsto=True,
        conciliado=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(faturamento_bruto)

    # Lança a despesa de taxas no dia do recebimento (data_pagamento do lote), adaptável por bandeira, regra e modalidade (Débito vs Crédito)
    if total_taxa > 0:
        modalidades_no_lote = set()
        for r in recebiveis:
            if r.forma_pagamento == "DEBITO":
                modalidades_no_lote.add("cartao_debito")
            elif r.forma_pagamento == "CREDITO_PARCELADO":
                modalidades_no_lote.add("cartao_credito_parcelado")
            else:
                modalidades_no_lote.add("cartao_credito_vista")

        tipo_pag_predominante = list(modalidades_no_lote)[0] if modalidades_no_lote else "cartao_credito_vista"
        modalidade_label = "Débito" if tipo_pag_predominante == "cartao_debito" else ("Crédito Parcelado" if tipo_pag_predominante == "cartao_credito_parcelado" else "Crédito")

        plano_taxa_id = None
        if lote.bandeira:
            regra = db.exec(
                select(RegraCartao)
                .where(
                    RegraCartao.empresa_id == empresa_id,
                    RegraCartao.bandeira == lote.bandeira.upper(),
                    RegraCartao.tipo_pagamento == tipo_pag_predominante,
                    RegraCartao.is_active == True
                )
            ).first()
            if not regra:
                regra = db.exec(
                    select(RegraCartao)
                    .where(
                        RegraCartao.empresa_id == empresa_id,
                        RegraCartao.bandeira == lote.bandeira.upper(),
                        RegraCartao.is_active == True
                    )
                ).first()

            if regra and regra.plano_contas_taxa_id:
                plano_taxa_id = regra.plano_contas_taxa_id

        if not plano_taxa_id:
            plano_taxa_id = obter_categoria_taxas_cartao(db, empresa_id)

        despesa_taxa = Lancamento(
            descricao=f"Taxa de Adm. Cartão {modalidade_label} ({lote.bandeira or 'Geral'}) Lote #{lote.id}",
            tipo="DESPESA",
            status="PAGO",
            origem="PDV",
            valor_previsto=total_taxa,
            valor_pago=total_taxa,
            valor_juros=Decimal("0.00"),
            valor_desconto=Decimal("0.00"),
            valor_multa=Decimal("0.00"),
            data_vencimento=lote_in.data_pagamento,
            data_pagamento=lote_in.data_pagamento,
            data_competencia=lote_in.data_pagamento,
            competencia=lote_in.data_pagamento.strftime("%m-%Y"),
            empresa_id=empresa_id,
            plano_contas_id=plano_taxa_id,
            conta_id=lote_in.conta_destino_id,
            created_by_id=current_user.id,
            updated_by_id=current_user.id,
            observacao=json.dumps({"lote_cartao_id": lote.id, "conciliacao_taxa": True, "modalidade": tipo_pag_predominante}),
            is_deleted=False,
            ipp=False,
            previsto=True,
            conciliado=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(despesa_taxa)

    # 7. Se houver lançamento de depósito bancário do extrato, conciliar
    if lote_in.lancamento_deposito_id:
        dep_entry = db.get(Lancamento, lote_in.lancamento_deposito_id)
        if dep_entry and dep_entry.empresa_id == empresa_id:
            dep_entry.status = "PAGO"
            dep_entry.conciliado = True
            dep_entry.data_pagamento = lote_in.data_pagamento
            dep_entry.valor_pago = total_liquido
            dep_entry.updated_by_id = current_user.id
            dep_entry.updated_at = datetime.utcnow()
            db.add(dep_entry)

    db.commit()
    db.refresh(lote)
    
    # Preencher itens associados para o schema de leitura (otimizado sem N+1 queries)
    db_items = db.exec(
        select(LoteCartaoItem)
        .where(LoteCartaoItem.lote_cartao_id == lote.id)
    ).all()
    
    mov_ids = [item.pdv_movimentacao_id for item in db_items if item.pdv_movimentacao_id]
    mov_map = {}
    if mov_ids:
        movs = db.exec(
            select(PdvMovimentacao)
            .where(
                PdvMovimentacao.id.in_(mov_ids),
                PdvMovimentacao.empresa_id == empresa_id
            )
        ).all()
        mov_map = {m.id: m for m in movs if m.id}

    itens_read = []
    for item in db_items:
        m_db = mov_map.get(item.pdv_movimentacao_id)
        itens_read.append(
            LoteCartaoItemRead(
                id=item.id,
                lote_cartao_id=item.lote_cartao_id,
                pdv_movimentacao_id=item.pdv_movimentacao_id,
                valor_bruto=item.valor_bruto,
                valor_taxa=item.valor_taxa,
                valor_liquido=item.valor_liquido,
                descricao_venda=m_db.descricao if m_db else None,
                data_venda=m_db.data if m_db else None
            )
        )
    
    return LoteCartaoRead(
        id=lote.id,
        empresa_id=lote.empresa_id,
        data_pagamento=lote.data_pagamento,
        valor_bruto=lote.valor_bruto,
        valor_taxa=lote.valor_taxa,
        valor_liquido=lote.valor_liquido,
        conta_destino_id=lote.conta_destino_id,
        lancamento_deposito_id=lote.lancamento_deposito_id,
        status=lote.status,
        itens=itens_read
    )


@router.get("/conciliacao/lotes/deposito/{deposito_id}", response_model=LoteCartaoRead)
def obter_lote_por_deposito(
    deposito_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Retorna os detalhes do lote de cartão associado a um lançamento de depósito."""
    lote = db.exec(
        select(LoteCartao)
        .where(
            LoteCartao.lancamento_deposito_id == deposito_id,
            LoteCartao.empresa_id == empresa_id
        )
    ).first()
    
    if not lote:
        raise HTTPException(status_code=404, detail="Lote de cartão não encontrado para este depósito.")
        
    db_items = db.exec(
        select(LoteCartaoItem)
        .where(LoteCartaoItem.lote_cartao_id == lote.id)
    ).all()
    
    mov_ids = [item.pdv_movimentacao_id for item in db_items if item.pdv_movimentacao_id]
    mov_map = {}
    if mov_ids:
        movs = db.exec(
            select(PdvMovimentacao)
            .where(
                PdvMovimentacao.id.in_(mov_ids),
                PdvMovimentacao.empresa_id == empresa_id
            )
        ).all()
        mov_map = {m.id: m for m in movs if m.id}

    itens_read = []
    for item in db_items:
        m_db = mov_map.get(item.pdv_movimentacao_id)
        itens_read.append(
            LoteCartaoItemRead(
                id=item.id,
                lote_cartao_id=item.lote_cartao_id,
                pdv_movimentacao_id=item.pdv_movimentacao_id,
                valor_bruto=item.valor_bruto,
                valor_taxa=item.valor_taxa,
                valor_liquido=item.valor_liquido,
                descricao_venda=m_db.descricao if m_db else None,
                data_venda=m_db.data if m_db else None
            )
        )
        
    return LoteCartaoRead(
        id=lote.id,
        empresa_id=lote.empresa_id,
        data_pagamento=lote.data_pagamento,
        valor_bruto=lote.valor_bruto,
        valor_taxa=lote.valor_taxa,
        valor_liquido=lote.valor_liquido,
        conta_destino_id=lote.conta_destino_id,
        lancamento_deposito_id=lote.lancamento_deposito_id,
        status=lote.status,
        itens=itens_read
    )


@router.delete("/conciliacao/lotes/{lote_id}", status_code=200)
def estornar_lote_cartao(
    lote_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Estorna (reverte) um lote de cartão conciliado, reabrindo os recebíveis e removendo os lançamentos split contábeis."""
    lote = db.get(LoteCartao, lote_id)
    if not lote or lote.empresa_id != empresa_id:
        raise HTTPException(status_code=404, detail="Lote de cartão não encontrado.")

    db_items = db.exec(
        select(LoteCartaoItem)
        .where(LoteCartaoItem.lote_cartao_id == lote.id)
    ).all()

    # 1. Reabrir os recebíveis de cartão associados no PDV (carregamento unificado em lote)
    mov_ids = [item.pdv_movimentacao_id for item in db_items if item.pdv_movimentacao_id]
    if mov_ids:
        movs = db.exec(
            select(PdvMovimentacao)
            .where(
                PdvMovimentacao.id.in_(mov_ids),
                PdvMovimentacao.empresa_id == empresa_id
            )
        ).all()
        for m_op in movs:
            m_op.conciliado = False
            m_op.conta_id = None
            m_op.updated_by_id = current_user.id
            m_op.updated_at = datetime.utcnow()
            db.add(m_op)

    # 2. Remover os lançamentos split (DRE) gerados no financeiro (Receita Bruta e Despesa de Taxa)
    splits = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            col(Lancamento.observacao).like(f'%"lote_cartao_id": {lote_id}%') | col(Lancamento.observacao).like(f'%"lote_cartao_id":{lote_id}%')
        )
    ).all()
    for s in splits:
        s.is_deleted = True
        s.deleted_at = datetime.utcnow()
        s.deleted_by_id = current_user.id
        db.add(s)

    # 3. Se o lote possuía um depósito bancário associado do extrato, desfazer a baixa (reabrir)
    if lote.lancamento_deposito_id:
        dep_entry = db.get(Lancamento, lote.lancamento_deposito_id)
        if dep_entry and dep_entry.empresa_id == empresa_id:
            dep_entry.status = "EM ABERTO"
            dep_entry.conciliado = False
            dep_entry.data_pagamento = None
            dep_entry.valor_pago = Decimal("0.00")
            dep_entry.updated_by_id = current_user.id
            dep_entry.updated_at = datetime.utcnow()
            db.add(dep_entry)

    # 4. Deletar fisicamente o lote e seus itens para liberar os recebíveis para nova conciliação
    for item in db_items:
        db.delete(item)
    db.delete(lote)

    db.commit()
    return {"message": "Lote estornado e conciliação desfeita com sucesso."}


# --- Rota para Importação de Vendas do PDV em Lote ---

@router.post("/vendas/importar", status_code=200)
def importar_vendas_pdv(
    *,
    db: Session = Depends(get_db),
    vendas_in: List[PdvVendaCreate],
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Importa uma lista de vendas em lote, calculando alertas e ignorando duplicadas (idempotência).
    """
    importados = 0
    duplicados = 0
    erros = 0
    detalhes_erros = []
    
    for idx, venda in enumerate(vendas_in):
        try:
            PdvService.criar_venda(
                db=db,
                venda_in=venda,
                empresa_id=empresa_id,
                current_user_id=int(current_user.id or 0)
            )
            db.commit()
            importados += 1
        except HTTPException as he:
            db.rollback()
            if "duplicada" in str(he.detail).lower():
                duplicados += 1
            else:
                erros += 1
                detalhes_erros.append(f"Venda #{idx + 1} (RV: {venda.rv or 'N/A'}): {he.detail}")
        except Exception as exc:
            db.rollback()
            erros += 1
            detalhes_erros.append(f"Venda #{idx + 1} (RV: {venda.rv or 'N/A'}): {str(exc)}")
            
    return {
        "status": "sucesso" if erros == 0 else "sucesso_parcial",
        "importados": importados,
        "duplicados": duplicados,
        "erros": erros,
        "detalhes_erros": detalhes_erros
    }


# --- Endpoints de Integração iFood ---

@router.get("/ifood/transacoes", response_model=List[PdvIfoodLancamentoRead])
def listar_transacoes_ifood(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Retorna a lista de transações iFood cadastradas para a empresa do usuário logado.
    """
    transacoes = db.exec(
        select(PdvIfoodLancamento)
        .where(
            PdvIfoodLancamento.empresa_id == empresa_id,
            PdvIfoodLancamento.is_deleted == False
        )
        .order_by(PdvIfoodLancamento.data_venda.desc(), PdvIfoodLancamento.id.desc())
    ).all()

    result = []
    for t in transacoes:
        despesas = t.despesas_extras_str.split(",") if t.despesas_extras_str else []
        result.append(
            PdvIfoodLancamentoRead(
                id=t.id,
                empresa_id=t.empresa_id,
                forma_recebimento=t.forma_recebimento,
                valor_bruto=t.valor_bruto,
                valor_liquido=t.valor_liquido,
                data_venda=t.data_venda,
                hora_venda=t.hora_venda,
                data_recebimento_ajustada=t.data_recebimento_ajustada,
                despesas_extras=despesas,
                status_conciliado=t.status_conciliado
            )
        )
    return result

@router.post("/ifood/transacoes", response_model=PdvIfoodLancamentoRead, status_code=201)
def criar_transacao_ifood(
    transacao_in: PdvIfoodLancamentoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Grava uma nova transação individual do iFood.
    Calcula o valor líquido subtraindo a taxa de comissão salva nas configurações.
    """
    # Carregar taxa comissão customizada
    empresa = db.get(Empresa, empresa_id)
    taxa_pct = 12.0
    if empresa and empresa.pdv_config:
        try:
            cfg = json.loads(empresa.pdv_config)
            taxa_pct = float(cfg.get("ifood_comissao_taxa", 12.0))
        except Exception:
            pass

    taxa_comissao = Decimal(str(taxa_pct)) / Decimal("100.0")
    desconto_taxa = transacao_in.valor_bruto * taxa_comissao
    valor_liquido = transacao_in.valor_bruto - desconto_taxa
    
    if valor_liquido < 0:
        valor_liquido = Decimal("0.00")

    despesas_extras_str = ",".join(transacao_in.despesas_extras) if transacao_in.despesas_extras else None

    nova_transacao = PdvIfoodLancamento(
        empresa_id=empresa_id,
        forma_recebimento=transacao_in.forma_recebimento,
        valor_bruto=transacao_in.valor_bruto,
        valor_liquido=valor_liquido,
        data_venda=transacao_in.data_venda,
        hora_venda=transacao_in.hora_venda or datetime.now().strftime("%H:%M:%S"),
        data_recebimento_ajustada=transacao_in.data_recebimento_ajustada,
        despesas_extras_str=despesas_extras_str,
        status_conciliado=False
    )
    
    nova_transacao.created_by_id = current_user.id
    nova_transacao.updated_by_id = current_user.id
    nova_transacao.created_at = datetime.utcnow()
    nova_transacao.updated_at = datetime.utcnow()
    
    db.add(nova_transacao)
    db.commit()
    db.refresh(nova_transacao)
    
    return PdvIfoodLancamentoRead(
        id=nova_transacao.id,
        empresa_id=nova_transacao.empresa_id,
        forma_recebimento=nova_transacao.forma_recebimento,
        valor_bruto=nova_transacao.valor_bruto,
        valor_liquido=nova_transacao.valor_liquido,
        data_venda=nova_transacao.data_venda,
        hora_venda=nova_transacao.hora_venda,
        data_recebimento_ajustada=nova_transacao.data_recebimento_ajustada,
        despesas_extras=transacao_in.despesas_extras or [],
        status_conciliado=nova_transacao.status_conciliado
    )


@router.get("/config", response_model=PdvConfigSchema)
def obter_config_pdv(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Retorna as configurações do PDV e aplicativos ativos para a empresa.
    """
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
        
    config_dict = {}
    if empresa.pdv_config:
        try:
            config_dict = json.loads(empresa.pdv_config)
        except Exception:
            pass
            
    return PdvConfigSchema(
        marcar_como_pago=config_dict.get("marcar_como_pago", {}),
        active_apps=config_dict.get("active_apps", []),
        ifood_comissao_taxa=config_dict.get("ifood_comissao_taxa", 12.0),
        ifood_merchant_name=config_dict.get("ifood_merchant_name", ""),
        centro_custo_padrao_id=config_dict.get("centro_custo_padrao_id"),
        centro_custo_flexivel=config_dict.get("centro_custo_flexivel", False),
        ifood_centro_custo_padrao_id=config_dict.get("ifood_centro_custo_padrao_id"),
        ifood_centro_custo_flexivel=config_dict.get("ifood_centro_custo_flexivel", False),
        pdv_centro_custo_padrao_id=config_dict.get("pdv_centro_custo_padrao_id"),
        pdv_centro_custo_flexivel=config_dict.get("pdv_centro_custo_flexivel", False),
        ifood_conta_padrao_id=config_dict.get("ifood_conta_padrao_id"),
        pdv_conta_padrao_id=config_dict.get("pdv_conta_padrao_id"),
        pdv_sangria_saida_plano_contas_id=config_dict.get("pdv_sangria_saida_plano_contas_id"),
        pdv_sangria_entrada_plano_contas_id=config_dict.get("pdv_sangria_entrada_plano_contas_id"),
        formas_pagamento=config_dict.get("formas_pagamento", []),
        categorias=config_dict.get("categorias", {}),
        contas=config_dict.get("contas", {})
    )


@router.put("/config", response_model=PdvConfigSchema)
def atualizar_config_pdv(
    config_in: PdvConfigSchema,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Atualiza as configurações do PDV e a ativação de aplicativos.
    """
    permissions = get_effective_permission_codes(
        db,
        user_id=int(current_user.id or 0),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )
    if "*" not in permissions and "page:configuracoes:view" not in permissions:
        raise HTTPException(status_code=403, detail="Você não tem permissão para alterar as configurações do PDV.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
        
    config_dict = {}
    if empresa.pdv_config:
        try:
            config_dict = json.loads(empresa.pdv_config)
        except Exception:
            pass
            
    if config_in.marcar_como_pago is not None:
        config_dict["marcar_como_pago"] = config_in.marcar_como_pago
    if config_in.active_apps is not None:
        config_dict["active_apps"] = config_in.active_apps
    if config_in.ifood_comissao_taxa is not None:
        config_dict["ifood_comissao_taxa"] = config_in.ifood_comissao_taxa
    if config_in.ifood_merchant_name is not None:
        config_dict["ifood_merchant_name"] = config_in.ifood_merchant_name
    if config_in.centro_custo_padrao_id is not None:
        config_dict["centro_custo_padrao_id"] = config_in.centro_custo_padrao_id
    if config_in.centro_custo_flexivel is not None:
        config_dict["centro_custo_flexivel"] = config_in.centro_custo_flexivel
        
    if config_in.ifood_centro_custo_padrao_id is not None:
        config_dict["ifood_centro_custo_padrao_id"] = config_in.ifood_centro_custo_padrao_id
    if config_in.ifood_centro_custo_flexivel is not None:
        config_dict["ifood_centro_custo_flexivel"] = config_in.ifood_centro_custo_flexivel
    if config_in.pdv_centro_custo_padrao_id is not None:
        config_dict["pdv_centro_custo_padrao_id"] = config_in.pdv_centro_custo_padrao_id
    if config_in.pdv_centro_custo_flexivel is not None:
        config_dict["pdv_centro_custo_flexivel"] = config_in.pdv_centro_custo_flexivel
        
    if config_in.ifood_conta_padrao_id is not None:
        config_dict["ifood_conta_padrao_id"] = config_in.ifood_conta_padrao_id
    if config_in.pdv_conta_padrao_id is not None:
        config_dict["pdv_conta_padrao_id"] = config_in.pdv_conta_padrao_id
    # Sangria plano de contas: persiste sempre que o campo foi enviado na request
    # (inclusive null, para permitir limpar a categoria configurada)
    if "pdv_sangria_saida_plano_contas_id" in (config_in.model_fields_set if hasattr(config_in, "model_fields_set") else config_in.__fields_set__):
        config_dict["pdv_sangria_saida_plano_contas_id"] = config_in.pdv_sangria_saida_plano_contas_id
    elif config_in.pdv_sangria_saida_plano_contas_id is not None:
        config_dict["pdv_sangria_saida_plano_contas_id"] = config_in.pdv_sangria_saida_plano_contas_id
    if "pdv_sangria_entrada_plano_contas_id" in (config_in.model_fields_set if hasattr(config_in, "model_fields_set") else config_in.__fields_set__):
        config_dict["pdv_sangria_entrada_plano_contas_id"] = config_in.pdv_sangria_entrada_plano_contas_id
    elif config_in.pdv_sangria_entrada_plano_contas_id is not None:
        config_dict["pdv_sangria_entrada_plano_contas_id"] = config_in.pdv_sangria_entrada_plano_contas_id

    if config_in.formas_pagamento is not None:
        config_dict["formas_pagamento"] = config_in.formas_pagamento
    if config_in.categorias is not None:
        config_dict["categorias"] = config_in.categorias
    if config_in.contas is not None:
        config_dict["contas"] = config_in.contas
        
    empresa.pdv_config = json.dumps(config_dict)
    empresa.updated_by_id = current_user.id
    empresa.updated_at = datetime.utcnow()
    
    db.add(empresa)
    db.commit()
    db.refresh(empresa)
    
    return PdvConfigSchema(
        marcar_como_pago=config_dict.get("marcar_como_pago", {}),
        active_apps=config_dict.get("active_apps", []),
        ifood_comissao_taxa=config_dict.get("ifood_comissao_taxa", 12.0),
        ifood_merchant_name=config_dict.get("ifood_merchant_name", ""),
        centro_custo_padrao_id=config_dict.get("centro_custo_padrao_id"),
        centro_custo_flexivel=config_dict.get("centro_custo_flexivel", False),
        ifood_centro_custo_padrao_id=config_dict.get("ifood_centro_custo_padrao_id"),
        ifood_centro_custo_flexivel=config_dict.get("ifood_centro_custo_flexivel", False),
        pdv_centro_custo_padrao_id=config_dict.get("pdv_centro_custo_padrao_id"),
        pdv_centro_custo_flexivel=config_dict.get("pdv_centro_custo_flexivel", False),
        ifood_conta_padrao_id=config_dict.get("ifood_conta_padrao_id"),
        pdv_conta_padrao_id=config_dict.get("pdv_conta_padrao_id"),
        pdv_sangria_saida_plano_contas_id=config_dict.get("pdv_sangria_saida_plano_contas_id"),
        pdv_sangria_entrada_plano_contas_id=config_dict.get("pdv_sangria_entrada_plano_contas_id"),
        formas_pagamento=config_dict.get("formas_pagamento", []),
        categorias=config_dict.get("categorias", {}),
        contas=config_dict.get("contas", {})
    )


@router.put("/ifood/transacoes/{transacao_id}", response_model=PdvIfoodLancamentoRead)
def atualizar_transacao_ifood(
    transacao_id: int,
    transacao_in: PdvIfoodLancamentoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Atualiza uma transação iFood existente antes de sua conciliação.
    """
    transacao = db.exec(
        select(PdvIfoodLancamento)
        .where(
            PdvIfoodLancamento.id == transacao_id,
            PdvIfoodLancamento.empresa_id == empresa_id,
            PdvIfoodLancamento.is_deleted == False
        )
    ).first()
    
    if not transacao:
        raise HTTPException(status_code=404, detail="Transação iFood não encontrada.")
        
    # Allow editing even if consolidated to give user full control over corrections
        
    if transacao_in.forma_recebimento is not None:
        transacao.forma_recebimento = transacao_in.forma_recebimento
        
    if transacao_in.valor_bruto is not None:
        transacao.valor_bruto = transacao_in.valor_bruto
        empresa = db.get(Empresa, empresa_id)
        taxa_pct = 12.0
        if empresa and empresa.pdv_config:
            try:
                cfg = json.loads(empresa.pdv_config)
                taxa_pct = float(cfg.get("ifood_comissao_taxa", 12.0))
            except Exception:
                pass
        taxa_comissao = Decimal(str(taxa_pct)) / Decimal("100.0")
        transacao.valor_liquido = transacao.valor_bruto * (Decimal("1.0") - taxa_comissao)
        if transacao.valor_liquido < 0:
            transacao.valor_liquido = Decimal("0.00")
            
    if transacao_in.data_venda is not None:
        transacao.data_venda = transacao_in.data_venda
        
    if transacao_in.hora_venda is not None:
        transacao.hora_venda = transacao_in.hora_venda
        
    if transacao_in.data_recebimento_ajustada is not None:
        transacao.data_recebimento_ajustada = transacao_in.data_recebimento_ajustada
        
    if transacao_in.despesas_extras is not None:
        transacao.despesas_extras_str = ",".join(transacao_in.despesas_extras) if transacao_in.despesas_extras else None
        
    if transacao_in.status_conciliado is not None:
        transacao.status_conciliado = transacao_in.status_conciliado
        
    transacao.updated_by_id = current_user.id
    transacao.updated_at = datetime.utcnow()
    
    db.add(transacao)
    db.commit()
    db.refresh(transacao)
    
    despesas = transacao.despesas_extras_str.split(",") if transacao.despesas_extras_str else []
    
    return PdvIfoodLancamentoRead(
        id=transacao.id,
        empresa_id=transacao.empresa_id,
        forma_recebimento=transacao.forma_recebimento,
        valor_bruto=transacao.valor_bruto,
        valor_liquido=transacao.valor_liquido,
        data_venda=transacao.data_venda,
        hora_venda=transacao.hora_venda,
        data_recebimento_ajustada=transacao.data_recebimento_ajustada,
        despesas_extras=despesas,
        status_conciliado=transacao.status_conciliado
    )


@router.delete("/ifood/transacoes/{transacao_id}", status_code=200)
def excluir_transacao_ifood(
    transacao_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Exclui logicamente uma transação iFood (is_deleted = True).
    """
    transacao = db.exec(
        select(PdvIfoodLancamento)
        .where(
            PdvIfoodLancamento.id == transacao_id,
            PdvIfoodLancamento.empresa_id == empresa_id,
            PdvIfoodLancamento.is_deleted == False
        )
    ).first()
    
    if not transacao:
        raise HTTPException(status_code=404, detail="Transação iFood não encontrada.")
        
    # Allow deleting even if consolidated to give user full control over corrections
        
    transacao.is_deleted = True
    transacao.updated_by_id = current_user.id
    transacao.updated_at = datetime.utcnow()
    
    db.add(transacao)
    db.commit()
    
    return {"status": "success", "message": "Transação excluída com sucesso."}


@router.post("/ifood/consolidar", status_code=200)
def consolidar_dia_ifood(
    consolidar_in: PdvIfoodConsolidarIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Consolida as transações do iFood de um dia específico e as envia ao fluxo de caixa geral com split de taxas.
    """
    from app.services.pdv_service import obter_categoria_taxas_delivery

    transacoes = db.exec(
        select(PdvIfoodLancamento)
        .where(
            PdvIfoodLancamento.empresa_id == empresa_id,
            PdvIfoodLancamento.data_venda == consolidar_in.data_venda,
            PdvIfoodLancamento.status_conciliado == False,
            PdvIfoodLancamento.is_deleted == False
        )
    ).all()
    
    if not transacoes:
        raise HTTPException(status_code=400, detail="Nenhuma transação pendente encontrada para esta data.")
        
    total_bruto = sum(t.valor_bruto for t in transacoes)
    total_liquido = sum(t.valor_liquido for t in transacoes)
    total_taxa = total_bruto - total_liquido
    
    conta = db.get(Conta, consolidar_in.conta_id)
    if not conta or conta.empresa_id != empresa_id:
        raise HTTPException(status_code=404, detail="Conta destino não encontrada.")
        
    data_recebimento = max(t.data_recebimento_ajustada for t in transacoes)
    
    # Sempre criar consolidados de iFood como EM ABERTO.
    # Isso evita duplicidade com a conciliação OFX (que trará o repasse real)
    # e impede alterações indesejadas/antecipadas no saldo da conta corrente real.
    status_l = "EM ABERTO"
    data_pagamento_l = None
    valor_pago_l = Decimal("0.00")

    desc = f"Repasse iFood Consolidado - Vendas {consolidar_in.data_venda.strftime('%d/%m/%Y')}"
    
    # Resolver o centro de custo padrão da empresa a partir do pdv_config
    empresa = db.get(Empresa, empresa_id)
    centro_custo_id = None
    if empresa and empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
            centro_custo_id = config.get("ifood_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
        except Exception:
            pass
            
    if not centro_custo_id:
        cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
        centro_custo_id = cc.id if cc else None

    plano_contas = db.exec(
        select(PlanoContas)
        .where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "R",
            PlanoContas.permite_lancamentos == True
        )
    ).all()
    
    plano_id = None
    for pc in plano_contas:
        if "ifood" in pc.nome.lower():
            plano_id = pc.id
            break
            
    if not plano_id and plano_contas:
        plano_id = plano_contas[0].id

    # 1. Lançar Receita Bruta (EM ABERTO)
    consolidado_receita = Lancamento(
        empresa_id=empresa_id,
        conta_id=consolidar_in.conta_id,
        plano_contas_id=plano_id,
        tipo="RECEITA",
        descricao=desc,
        valor_previsto=total_bruto,
        valor_pago=valor_pago_l,
        data_vencimento=data_recebimento,
        data_pagamento=data_pagamento_l,
        data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, consolidar_in.data_venda),
        competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, consolidar_in.data_venda).strftime("%m-%Y"),
        status=status_l,
        origem="IFOOD",
        id_parcelamento=None,
        centro_custo_id=centro_custo_id,
        observacao=json.dumps({"ifood_consolidado": True})
    )
    consolidado_receita.created_by_id = current_user.id
    consolidado_receita.updated_by_id = current_user.id
    consolidado_receita.created_at = datetime.utcnow()
    consolidado_receita.updated_at = datetime.utcnow()
    
    db.add(consolidado_receita)
    db.flush()

    # Linkar o lote do id_parcelamento à receita principal
    consolidado_receita.id_parcelamento = consolidado_receita.id
    db.add(consolidado_receita)

    # 2. Lançar Comissão/Taxa como Despesa (EM ABERTO) se total_taxa > 0
    if total_taxa > 0:
        plano_taxa_delivery_id = obter_categoria_taxas_delivery(db, empresa_id)
        consolidado_despesa = Lancamento(
            empresa_id=empresa_id,
            conta_id=consolidar_in.conta_id,
            plano_contas_id=plano_taxa_delivery_id,
            tipo="DESPESA",
            descricao=f"Comissão/Taxa iFood - Vendas {consolidar_in.data_venda.strftime('%d/%m/%Y')}",
            valor_previsto=total_taxa,
            valor_pago=Decimal("0.00"),
            data_vencimento=data_recebimento,
            data_pagamento=None,
            data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, consolidar_in.data_venda),
            competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, consolidar_in.data_venda).strftime("%m-%Y"),
            status="EM ABERTO",
            origem="IFOOD",
            id_parcelamento=consolidado_receita.id,
            centro_custo_id=centro_custo_id,
            observacao=json.dumps({"ifood_consolidado_taxa": True})
        )
        consolidado_despesa.created_by_id = current_user.id
        consolidado_despesa.updated_by_id = current_user.id
        consolidado_despesa.created_at = datetime.utcnow()
        consolidado_despesa.updated_at = datetime.utcnow()
        db.add(consolidado_despesa)
    
    # 3. Vincular as transações ao lançamento consolidado receita
    for t in transacoes:
        t.status_conciliado = True
        t.lancamento_consolidado_id = consolidado_receita.id
        t.updated_by_id = current_user.id
        t.updated_at = datetime.utcnow()
        db.add(t)
        
    db.commit()
    return {"status": "success", "lancamento_id": consolidado_receita.id, "valor_consolidado": float(total_liquido)}


# ==============================================================================
# ENDPOINTS PARA MOVIMENTAÇÕES SIMPLIFICADAS DE PDV (FLUXO UMARIZAL)
# ==============================================================================

from pydantic import BaseModel
from decimal import Decimal
import json

class MovimentacaoPDVSchema(BaseModel):
    id: Optional[int] = None
    tipo: str  # ENTRADA, SAIDA
    descricao: str
    valor: Decimal
    forma_pagamento: str  # DINHEIRO, PIX, DEBITO, CREDITO_AVISTA, CREDITO_PARCELADO
    bandeira: Optional[str] = "OUTROS"
    parcelas: Optional[int] = 1
    data: date
    centro_custo_id: Optional[int] = None
    conta_id: Optional[int] = None
    conciliado: Optional[bool] = False

@router.get("/movimentacoes")
def listar_movimentacoes_pdv(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user),
    mes: Optional[str] = Query(None)  # formato YYYY-MM
):
    """
    Lista as movimentações do PDV de forma agrupada por data.
    """
    from sqlalchemy import func
    
    # 1. If month not provided, find the latest month with data up to today dynamically
    if not mes or not isinstance(mes, str) or "-" not in mes:
        today_d = date.today()
        latest_date = db.exec(
            select(func.max(PdvMovimentacao.data))
            .where(
                PdvMovimentacao.empresa_id == empresa_id,
                PdvMovimentacao.is_deleted == False,
                PdvMovimentacao.data <= today_d
            )
        ).first()
        if not latest_date:
            latest_date = db.exec(
                select(func.max(PdvMovimentacao.data))
                .where(
                    PdvMovimentacao.empresa_id == empresa_id,
                    PdvMovimentacao.is_deleted == False
                )
            ).first()
        if latest_date:
            mes = str(latest_date)[:7]
        else:
            mes = today_d.strftime("%Y-%m")

    # 2. Build date range for the selected month to ensure database-independent index-friendly scan
    try:
        year, month = map(int, mes.split("-"))
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
    except Exception:
        # Fallback in case of parsing errors
        start_date = date.today().replace(day=1)
        end_date = start_date

    query = select(PdvMovimentacao).where(
        PdvMovimentacao.empresa_id == empresa_id,
        PdvMovimentacao.is_deleted == False,
        PdvMovimentacao.data >= start_date,
        PdvMovimentacao.data < end_date
    ).order_by(PdvMovimentacao.data.desc(), PdvMovimentacao.id.desc())
    
    movs = db.exec(query).all()
    
    # Pre-fetch contas para mapeamento rápido de nomes
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    contas_map = {c.id: c.nome for c in contas if c.id is not None}

    movimentacoes = []
    for m in movs:
        conta_destino_id = None
        conta_destino_nome = None
        if not m.venda_id:
            l_orig = db.get(Lancamento, m.id)
            if l_orig and l_orig.observacao and "sangria" in l_orig.observacao.lower():
                try:
                    meta_s = json.loads(l_orig.observacao)
                    conta_destino_id = meta_s.get("conta_destino_id")
                    if conta_destino_id:
                        conta_destino_nome = contas_map.get(conta_destino_id)
                except Exception:
                    pass

        movimentacoes.append({
            "id": m.id,
            "id_parcelamento": m.venda_id,
            "tipo": m.tipo,
            "descricao": m.descricao,
            "valor": float(m.valor),
            "forma_pagamento": m.forma_pagamento,
            "bandeira": m.bandeira,
            "parcelas": m.parcelas,
            "numero_parcela": m.numero_parcela,
            "data": str(m.data),
            "centro_custo_id": m.centro_custo_id,
            "conta_id": m.conta_id,
            "conta_destino_id": conta_destino_id,
            "conta_destino_nome": conta_destino_nome,
            "conciliado": m.conciliado
        })
        
    return movimentacoes

@router.post("/movimentacoes")
def criar_movimentacao_pdv(
    mov_in: MovimentacaoPDVSchema,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Cria uma nova movimentação (Entrada/Venda ou Saída/Sangria) e gera os respectivos lançamentos.
    """
    # Resolve o centro de custo
    cc_id = mov_in.centro_custo_id
    if not cc_id:
        empresa = db.get(Empresa, empresa_id)
        if empresa and empresa.pdv_config:
            try:
                config = json.loads(empresa.pdv_config)
                cc_id = config.get("pdv_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
            except Exception:
                pass
        if not cc_id:
            cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
            cc_id = cc.id if cc else None

    # Resolve a conta de destino
    c_id = mov_in.conta_id
    if not c_id:
        empresa = db.get(Empresa, empresa_id)
        if empresa and empresa.pdv_config:
            try:
                config = json.loads(empresa.pdv_config)
                c_id = config.get("pdv_conta_padrao_id")
            except Exception:
                pass
        if not c_id:
            c_id = obter_conta_caixa_fisica(db, empresa_id)

    if mov_in.tipo == "ENTRADA":
        # Obter ou criar Cliente Consumidor default se for ENTRADA
        default_client = db.exec(
            select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.nome == "Cliente Consumidor")
        ).first()
        if not default_client:
            default_client = Entidade(
                nome="Cliente Consumidor",
                tipo="CLIENTE",
                empresa_id=empresa_id,
                is_active=True
            )
            db.add(default_client)
            db.flush()

        # Se for DINHEIRO:
        if mov_in.forma_pagamento == "DINHEIRO":
            pc_id = None
            empresa = db.get(Empresa, empresa_id)
            if empresa and empresa.pdv_config:
                try:
                    config = json.loads(empresa.pdv_config)
                    pc_id_str = config.get("categorias", {}).get("dinheiro")
                    if pc_id_str:
                        pc_id = int(pc_id_str)
                except Exception:
                    pass

            if not pc_id:
                pc_receita = db.exec(
                    select(PlanoContas)
                    .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "R", PlanoContas.permite_lancamentos == True)
                ).first()
                if not pc_receita:
                    pc_receita = PlanoContas(
                        nome="Receitas de Vendas",
                        tipo="R",
                        empresa_id=empresa_id,
                        permite_lancamentos=True,
                        codigo="1.01.01"
                    )
                    db.add(pc_receita)
                    db.flush()
                pc_id = pc_receita.id
            
            meta = {
                "is_movimentacao_pdv": True,
                "forma_pagamento": mov_in.forma_pagamento,
                "total_parcelas": 1
            }
            
            mov_uuid = f"mov_{uuid.uuid4()}"
            l = Lancamento(
                empresa_id=empresa_id,
                conta_id=c_id,
                plano_contas_id=pc_id,
                tipo="RECEITA",
                descricao=mov_in.descricao,
                valor_previsto=mov_in.valor,
                valor_pago=mov_in.valor,
                data_vencimento=mov_in.data,
                data_pagamento=mov_in.data,
                data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, mov_in.data),
                status="PAGO",
                entidade_id=default_client.id,
                centro_custo_id=cc_id,
                id_parcelamento=mov_uuid,
                observacao=json.dumps(meta, ensure_ascii=False)
            )
            l.created_by_id = current_user.id
            l.updated_by_id = current_user.id
            l.created_at = datetime.utcnow()
            l.updated_at = datetime.utcnow()
            db.add(l)
            db.flush()

            # Criar registro na nova tabela pdv_movimentacoes
            m_op = PdvMovimentacao(
                empresa_id=empresa_id,
                tipo="ENTRADA",
                descricao=mov_in.descricao,
                valor=mov_in.valor,
                forma_pagamento=mov_in.forma_pagamento,
                bandeira=mov_in.bandeira or "OUTROS",
                parcelas=mov_in.parcelas or 1,
                data=mov_in.data,
                centro_custo_id=cc_id,
                conta_id=c_id,
                conciliado=False,
                venda_id=mov_uuid,
                created_by_id=current_user.id,
                updated_by_id=current_user.id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(m_op)
            db.commit()
            return {"status": "success", "id": m_op.id}
            
        else:
            # É pagamento com cartão ou PIX (DEBITO, CREDITO_AVISTA, CREDITO_PARCELADO, PIX)
            from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
            
            tipo_pag_map = {
                "DEBITO": "cartao_debito",
                "CREDITO_AVISTA": "cartao_credito_vista",
                "CREDITO_PARCELADO": "cartao_credito_parcelado",
                "PIX": "pix_chave"
            }
            tipo_pag_backend = tipo_pag_map.get(mov_in.forma_pagamento, "cartao_debito")
            
            venda_in = PdvVendaCreate(
                entidade_id=default_client.id,
                centro_custo_id=cc_id,
                vendedor_id=current_user.id,
                desconto=Decimal("0.00"),
                status="REALIZADO",
                data=mov_in.data,
                data_pagamento=mov_in.data,
                itens=[
                    PdvVendaItemCreate(
                        produto_id=0,
                        quantidade=Decimal("1.00"),
                        preco_unitario=mov_in.valor,
                        nome_produto_avulso=mov_in.descricao
                    )
                ],
                pagamentos=[
                    PdvVendaPagamento(
                        tipo_pagamento=tipo_pag_backend,
                        valor=mov_in.valor,
                        numero_parcelas=mov_in.parcelas or 1,
                        bandeira=mov_in.bandeira or "OUTROS",
                        data_pagamento=mov_in.data
                    )
                ],
                observacao=mov_in.descricao
            )
            
            res_venda = PdvService.criar_venda(
                db=db,
                venda_in=venda_in,
                empresa_id=empresa_id,
                current_user_id=current_user.id
            )
            
            venda_uuid = res_venda.venda_id_uuid
            lancamentos_criados = db.exec(
                select(Lancamento).where(Lancamento.id_parcelamento == venda_uuid)
            ).all()
            
            for l in lancamentos_criados:
                meta = {}
                if l.observacao:
                    try:
                        meta = json.loads(l.observacao)
                    except:
                        meta = {}
                meta["is_movimentacao_pdv"] = True
                meta["forma_pagamento"] = mov_in.forma_pagamento
                l.observacao = json.dumps(meta, ensure_ascii=False)
                db.add(l)

            db.commit()
            return {"status": "success", "id_parcelamento": venda_uuid}
            
    else:
        # É uma SAÍDA (Sangria/Retirada)
        pc_id = None
        empresa = db.get(Empresa, empresa_id)
        if empresa and empresa.pdv_config:
            try:
                config = json.loads(empresa.pdv_config)
                pc_id_str = config.get("categorias", {}).get("sangria") or config.get("categorias", {}).get("despesa")
                if pc_id_str:
                    pc_id = int(pc_id_str)
            except Exception:
                pass

        if not pc_id:
            pc_despesa = db.exec(
                select(PlanoContas)
                .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "D", PlanoContas.permite_lancamentos == True)
            ).first()
            if not pc_despesa:
                pc_despesa = PlanoContas(
                    nome="Despesas Operacionais",
                    tipo="D",
                    empresa_id=empresa_id,
                    permite_lancamentos=True,
                    codigo="2.01.01"
                )
                db.add(pc_despesa)
                db.flush()
            pc_id = pc_despesa.id

        meta = {
            "is_movimentacao_pdv": True,
            "forma_pagamento": "DINHEIRO",
            "total_parcelas": 1
        }
        
        mov_uuid = f"mov_{uuid.uuid4()}"
        l = Lancamento(
            empresa_id=empresa_id,
            conta_id=c_id,
            plano_contas_id=pc_id,
            tipo="DESPESA",
            descricao=mov_in.descricao,
            valor_previsto=mov_in.valor,
            valor_pago=mov_in.valor,
            data_vencimento=mov_in.data,
            data_pagamento=mov_in.data,
            data_competencia=PeriodoService.validar_e_ajustar_competencia(db, empresa_id, mov_in.data),
            status="PAGO",
            centro_custo_id=cc_id,
            id_parcelamento=mov_uuid,
            observacao=json.dumps(meta, ensure_ascii=False)
        )
        l.created_by_id = current_user.id
        l.updated_by_id = current_user.id
        l.created_at = datetime.utcnow()
        l.updated_at = datetime.utcnow()
        db.add(l)
        db.flush()

        # Criar registro na nova tabela pdv_movimentacoes
        m_op = PdvMovimentacao(
            empresa_id=empresa_id,
            tipo="SAIDA",
            descricao=mov_in.descricao,
            valor=mov_in.valor,
            forma_pagamento="DINHEIRO",
            bandeira="OUTROS",
            parcelas=1,
            data=mov_in.data,
            centro_custo_id=cc_id,
            conta_id=c_id,
            conciliado=False,
            venda_id=mov_uuid,
            created_by_id=current_user.id,
            updated_by_id=current_user.id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(m_op)
        db.commit()
        return {"status": "success", "id": l.id}


@router.post("/sangrias")
def criar_sangria_pdv(
    sangria_in: SangriaCreateSchema,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Registra uma sangria de caixa: cria um lançamento de saída (DESPESA) no PDV e 
    um lançamento de entrada (RECEITA) na conta de destino bancária.
    """
    permissions = get_effective_permission_codes(
        db,
        user_id=int(current_user.id or 0),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )
    if "*" not in permissions and PdvPermission.PDV_REALIZAR_SANGRIA.value not in permissions:
        raise HTTPException(status_code=403, detail="Você não tem permissão para realizar sangria de caixa.")
    # 1. Obter config do PDV
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    
    config = {}
    if empresa.pdv_config:
        try:
            config = json.loads(empresa.pdv_config)
        except:
            pass
            
    pdv_conta_id = config.get("pdv_conta_padrao_id")
    if not pdv_conta_id:
        raise HTTPException(
            status_code=400, 
            detail="Conta padrão do PDV não configurada nas preferências do Aplicativo."
        )
        
    if pdv_conta_id == sangria_in.conta_destino_id:
        raise HTTPException(
            status_code=400,
            detail="A conta de destino não pode ser a própria conta do PDV."
        )
        
    # Verificar se as contas existem e pertencem à empresa
    conta_origem = db.exec(
        select(Conta).where(Conta.id == pdv_conta_id, Conta.empresa_id == empresa_id)
    ).first()
    conta_destino = db.exec(
        select(Conta).where(Conta.id == sangria_in.conta_destino_id, Conta.empresa_id == empresa_id)
    ).first()
    
    if not conta_origem:
        raise HTTPException(status_code=400, detail="Conta de origem (PDV) não encontrada.")
    if not conta_destino:
        raise HTTPException(status_code=400, detail="Conta de destino não encontrada.")

    # 2. Obter categorias (PlanoContas) configuradas
    saida_pc_id = config.get("pdv_sangria_saida_plano_contas_id")
    entrada_pc_id = config.get("pdv_sangria_entrada_plano_contas_id")
    
    # Fallback para Saída se não configurado
    if not saida_pc_id:
        # PlanoContas.tipo usa 'D' (Despesa), não 'DESPESA'
        pc_despesa = db.exec(
            select(PlanoContas).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.tipo == "D",
                PlanoContas.permite_lancamentos == True
            )
        ).first()
        if not pc_despesa:
            pc_despesa = PlanoContas(
                nome="Sangria / Despesas Operacionais",
                tipo="D",
                empresa_id=empresa_id,
                permite_lancamentos=True,
                codigo="2.01.01"
            )
            db.add(pc_despesa)
            db.flush()
        saida_pc_id = pc_despesa.id
        
    # Fallback para Entrada se não configurado
    if not entrada_pc_id:
        # PlanoContas.tipo usa 'R' (Receita), não 'RECEITA'
        pc_receita = db.exec(
            select(PlanoContas).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.tipo == "R",
                PlanoContas.permite_lancamentos == True
            )
        ).first()
        if not pc_receita:
            pc_receita = PlanoContas(
                nome="Receitas de Vendas",
                tipo="R",
                empresa_id=empresa_id,
                permite_lancamentos=True,
                codigo="1.01.01"
            )
            db.add(pc_receita)
            db.flush()
        entrada_pc_id = pc_receita.id

    # Resolve Centro de Custo
    cc_id = config.get("pdv_centro_custo_padrao_id") or config.get("centro_custo_padrao_id")
    if not cc_id:
        cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).first()
        if not cc:
            cc = CentroCusto(
                nome="Matriz",
                empresa_id=empresa_id
            )
            db.add(cc)
            db.flush()
        cc_id = cc.id

    venda_uuid = str(uuid.uuid4())
    data_str = sangria_in.data.strftime("%d/%m/%Y")
    competencia_str = f"{sangria_in.data.month:02d}-{sangria_in.data.year}"

    # Obter ou criar interessado 'Sangria' para a saída (DESPESA)
    default_supplier = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.nome == "Sangria"
        )
    ).first()
    if not default_supplier:
        default_supplier = Entidade(
            nome="Sangria",
            tipo="FORNECEDOR",
            empresa_id=empresa_id
        )
        db.add(default_supplier)
        db.flush()

    # 3. Criar Lançamento de Saída no PDV (DESPESA)
    meta_saida = {
        "is_movimentacao_pdv": True,
        "forma_pagamento": "DINHEIRO",
        "total_parcelas": 1,
        "is_sangria": True,
        "sangria_uuid": venda_uuid
    }
    
    desc_saida = f"Sangria {data_str}"
    if sangria_in.descricao and sangria_in.descricao != "Sangria de Caixa":
        desc_saida = f"{sangria_in.descricao} {data_str}"
        
    l_saida = Lancamento(
        empresa_id=empresa_id,
        conta_id=pdv_conta_id,
        plano_contas_id=saida_pc_id,
        tipo="DESPESA",
        descricao=desc_saida,
        valor_previsto=sangria_in.valor,
        valor_pago=sangria_in.valor,
        data_vencimento=sangria_in.data,
        data_pagamento=sangria_in.data,
        data_competencia=sangria_in.data,
        competencia=competencia_str,
        status="PAGO",
        entidade_id=default_supplier.id,
        centro_custo_id=cc_id,
        id_parcelamento=venda_uuid,
        observacao=json.dumps(meta_saida, ensure_ascii=False)
    )
    l_saida.created_by_id = current_user.id
    l_saida.updated_by_id = current_user.id
    l_saida.created_at = datetime.utcnow()
    l_saida.updated_at = datetime.utcnow()
    db.add(l_saida)
    db.flush()

    # Criar registro na pdv_movimentacoes para a Saída
    m_op = PdvMovimentacao(
        id=l_saida.id,
        empresa_id=empresa_id,
        tipo="SAIDA",
        descricao=desc_saida,
        valor=sangria_in.valor,
        forma_pagamento="DINHEIRO",
        bandeira="OUTROS",
        parcelas=1,
        data=sangria_in.data,
        centro_custo_id=cc_id,
        conta_id=pdv_conta_id,
        conciliado=False,
        venda_id=None,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(m_op)

    # 4. Criar Lançamento de Entrada no Banco Destino (RECEITA)
    meta_entrada = {
        "is_sangria_entrada": True,
        "origem_conta_id": pdv_conta_id,
        "sangria_uuid": venda_uuid
    }
    
    desc_entrada = f"Sangria {data_str}"
    if sangria_in.descricao and sangria_in.descricao != "Sangria de Caixa":
        desc_entrada = f"{sangria_in.descricao} {data_str}"

    # Cliente Consumidor default para a receita
    default_client = db.exec(
        select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.nome == "Cliente Consumidor")
    ).first()
    if not default_client:
        default_client = Entidade(
            nome="Cliente Consumidor",
            tipo="CLIENTE",
            empresa_id=empresa_id
        )
        db.add(default_client)
        db.flush()

    l_entrada = Lancamento(
        empresa_id=empresa_id,
        conta_id=sangria_in.conta_destino_id,
        plano_contas_id=entrada_pc_id,
        tipo="RECEITA",
        descricao=desc_entrada,
        valor_previsto=sangria_in.valor,
        valor_pago=sangria_in.valor,
        data_vencimento=sangria_in.data,
        data_pagamento=sangria_in.data,
        data_competencia=sangria_in.data,
        competencia=competencia_str,
        status="PAGO",
        entidade_id=default_supplier.id,
        centro_custo_id=cc_id,
        id_parcelamento=venda_uuid,
        observacao=json.dumps(meta_entrada, ensure_ascii=False)
    )
    l_entrada.created_by_id = current_user.id
    l_entrada.updated_by_id = current_user.id
    l_entrada.created_at = datetime.utcnow()
    l_entrada.updated_at = datetime.utcnow()
    db.add(l_entrada)
    
    db.commit()
    return {"status": "success", "saida_id": l_saida.id, "entrada_id": l_entrada.id}


@router.delete("/movimentacoes/{id}")
def deletar_movimentacao_pdv(
    id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Exclui uma movimentação do PDV.
    Trava a exclusão se a transação (ou qualquer uma de suas parcelas) já estiver conciliada.
    """
    m_op = db.get(PdvMovimentacao, id)
    if not m_op or m_op.empresa_id != empresa_id or m_op.is_deleted:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada.")
        
    # Obter os lançamentos contábeis associados
    if m_op.venda_id:
        lancamentos_to_delete = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.id_parcelamento == m_op.venda_id,
                Lancamento.is_deleted == False
            )
        ).all()
    else:
        l = db.get(Lancamento, m_op.id)
        lancamentos_to_delete = [l] if l else []
        
    for lanc in lancamentos_to_delete:
        if lanc.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Esta movimentação (ou parcelas associadas) já foi conciliada no extrato e não pode ser excluída."
            )
            
    # Exclusão lógica dos registros
    m_op.is_deleted = True
    m_op.deleted_at = datetime.utcnow()
    m_op.deleted_by_id = current_user.id
    db.add(m_op)
    
    if m_op.venda_id:
        venda_op = db.get(PdvVenda, m_op.venda_id)
        if venda_op:
            venda_op.is_deleted = True
            venda_op.deleted_at = datetime.utcnow()
            venda_op.deleted_by_id = current_user.id
            db.add(venda_op)

        # 1. Reversão em cascata das baixas de estoque da venda
        movs_estoque = db.exec(
            select(MovimentacaoEstoque).where(
                MovimentacaoEstoque.empresa_id == empresa_id,
                MovimentacaoEstoque.chave_nfe == f"pdv:{m_op.venda_id}",
                MovimentacaoEstoque.is_deleted == False
            )
        ).all()
        for me in movs_estoque:
            me.is_deleted = True
            me.deleted_at = datetime.utcnow()
            me.deleted_by_id = current_user.id
            db.add(me)
    else:
        # 2. Exclusão em cascata de Sangrias (deletar a perna de entrada no banco destino)
        l_saida = db.get(Lancamento, m_op.id)
        if l_saida and l_saida.observacao:
            try:
                meta_s = json.loads(l_saida.observacao)
                sangria_uuid = meta_s.get("sangria_uuid") or l_saida.id_parcelamento
                if sangria_uuid:
                    entradas_banco = db.exec(
                        select(Lancamento).where(
                            Lancamento.empresa_id == empresa_id,
                            Lancamento.id_parcelamento == sangria_uuid,
                            Lancamento.is_deleted == False
                        )
                    ).all()
                    for eb in entradas_banco:
                        eb.is_deleted = True
                        eb.deleted_at = datetime.utcnow()
                        eb.updated_by_id = current_user.id
                        db.add(eb)
            except Exception:
                pass
            
    for lanc in lancamentos_to_delete:
        lanc.is_deleted = True
        lanc.updated_by_id = current_user.id
        lanc.updated_at = datetime.utcnow()
        db.add(lanc)
        
    db.commit()
    return {"status": "success", "message": "Movimentação excluída com sucesso."}

@router.put("/movimentacoes/{id}")
def atualizar_movimentacao_pdv(
    id: int,
    mov_in: MovimentacaoPDVSchema,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Atualiza uma movimentação do PDV excluindo os lançamentos antigos e gerando novos.
    Bloqueia se já estiver conciliada.
    """
    m_op = db.get(PdvMovimentacao, id)
    if not m_op or m_op.empresa_id != empresa_id or m_op.is_deleted:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada.")
        
    # Obter os lançamentos contábeis associados
    if m_op.venda_id:
        lancamentos_to_delete = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.id_parcelamento == m_op.venda_id,
                Lancamento.is_deleted == False
            )
        ).all()
    else:
        l_orig = db.get(Lancamento, m_op.id)
        lancamentos_to_delete = [l_orig] if l_orig else []
        
    for lanc in lancamentos_to_delete:
        if lanc.conciliado:
            raise HTTPException(
                status_code=400,
                detail="Esta movimentação já foi conciliada e não pode ser editada."
            )
        if lanc.observacao:
            try:
                meta = json.loads(lanc.observacao)
                if meta.get("is_sangria") or meta.get("is_sangria_entrada"):
                    raise HTTPException(
                        status_code=400,
                        detail="Sangrias não podem ser editadas diretamente. Por favor, exclua a sangria e registre uma nova."
                    )
            except:
                pass
            
    # Excluir logicamente a antiga movimentação
    m_op.is_deleted = True
    m_op.deleted_at = datetime.utcnow()
    m_op.deleted_by_id = current_user.id
    db.add(m_op)
    
    if m_op.venda_id:
        venda_op = db.get(PdvVenda, m_op.venda_id)
        if venda_op:
            venda_op.is_deleted = True
            venda_op.deleted_at = datetime.utcnow()
            venda_op.deleted_by_id = current_user.id
            db.add(venda_op)

        # Invalidar baixas de estoque antigas antes de criar a nova versão da venda
        movs_estoque_antigos = db.exec(
            select(MovimentacaoEstoque).where(
                MovimentacaoEstoque.empresa_id == empresa_id,
                MovimentacaoEstoque.chave_nfe == f"pdv:{m_op.venda_id}",
                MovimentacaoEstoque.is_deleted == False
            )
        ).all()
        for me in movs_estoque_antigos:
            me.is_deleted = True
            me.deleted_at = datetime.utcnow()
            me.deleted_by_id = current_user.id
            db.add(me)
            
    for lanc in lancamentos_to_delete:
        lanc.is_deleted = True
        lanc.updated_by_id = current_user.id
        lanc.updated_at = datetime.utcnow()
        db.add(lanc)
    db.flush()
    
    res = criar_movimentacao_pdv(mov_in=mov_in, db=db, empresa_id=empresa_id, current_user=current_user)
    return res


@router.delete("/conciliacao/lotes/{id}")
def deletar_lote_cartao(
    id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user)
):
    """Cancela/desfaz a conciliação de um lote de cartões."""
    lote = db.get(LoteCartao, id)
    if not lote or lote.empresa_id != empresa_id:
        raise HTTPException(status_code=404, detail="Lote de cartão não encontrado.")
    
    # Desativar lançamentos financeiros de split gerados pelo lote
    lancamentos = db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            col(Lancamento.observacao).like(f'%"lote_cartao_id": {id}%'),
            Lancamento.is_deleted == False
        )
    ).all()
    for l in lancamentos:
        l.is_deleted = True
        l.updated_at = datetime.utcnow()
        l.updated_by_id = current_user.id
        db.add(l)

    # Restaurar recebíveis para conciliado = False
    itens = db.exec(select(LoteCartaoItem).where(LoteCartaoItem.lote_cartao_id == id)).all()
    for item in itens:
        m = db.get(PdvMovimentacao, item.pdv_movimentacao_id)
        if m:
            m.conciliado = False
            db.add(m)
        db.delete(item)

    db.delete(lote)
    db.commit()
    return {"status": "success", "message": "Lote de cartão desfeito com sucesso."}
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
from app.models.movimentacao_estoque import MovimentacaoEstoque
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
    LoteCartaoItemRead
)
from app.services.access_control_service import get_effective_permission_codes
from app.services.pdv_service import PdvService
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
    permissions = get_effective_permission_codes(
        db,
        user_id=int(current_user.id or 0),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )
    pode_ver_todas = "*" in permissions or PdvPermission.PDV_VER_TODAS_VENDAS.value in permissions

    query = (
        select(Lancamento, Usuario)
        .join(Usuario, Usuario.id == Lancamento.created_by_id, isouter=True)  # type: ignore
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA",
            Lancamento.origem == "PDV",
        )
        .order_by(Lancamento.data_competencia.desc(), Lancamento.id.desc())  # type: ignore
    )

    if not pode_ver_todas:
        query = query.where(Lancamento.created_by_id == current_user.id)

    query = query.limit(limit)

    rows = db.exec(query).all()
    has_more = len(rows) >= limit

    # Group launches by id_parcelamento (which represents the pdv_venda_id UUID)
    venda_launches = defaultdict(list)
    venda_vendedores = {}

    for lancamento, vendedor in rows:
        venda_id = lancamento.id_parcelamento or f"legacy-{lancamento.id}"
        venda_launches[venda_id].append(lancamento)
        if venda_id not in venda_vendedores:
            venda_vendedores[venda_id] = (vendedor.nome or vendedor.email) if vendedor else "Sem vendedor"

    consolidated_items = []

    # Eager load attachments to avoid N+1 query inside the loop
    first_launch_ids = []
    venda_launches_sorted = {}
    for venda_id, launches in venda_launches.items():
        launches_sorted = sorted(launches, key=lambda l: l.id or 0)
        venda_launches_sorted[venda_id] = launches_sorted
        if launches_sorted:
            first_launch_ids.append(launches_sorted[0].id)

    anexos_map = {}
    if first_launch_ids:
        db_anexos_all = db.exec(
            select(AnexoLancamento)
            .where(
                AnexoLancamento.lancamento_id.in_(first_launch_ids),
                AnexoLancamento.empresa_id == empresa_id,
                AnexoLancamento.is_deleted == False
            )
        ).all()
        for an in db_anexos_all:
            anexos_map.setdefault(an.lancamento_id, []).append(an.url)

    for venda_id, launches in venda_launches.items():
        launches_sorted = venda_launches_sorted[venda_id]
        first_launch = launches_sorted[0]

        meta = {}
        if first_launch.observacao:
            try:
                meta = json.loads(first_launch.observacao)
            except Exception:
                pass

        # Total value is the sum of valor_previsto of all launches in this group
        valor_venda = sum(Decimal(l.valor_previsto or 0) for l in launches)
        cliente = meta.get("cliente")
        sale_status = meta.get("status", first_launch.status)
        comprovante_urls = meta.get("comprovante_urls") or []
        if meta.get("comprovante_url") and meta.get("comprovante_url") not in comprovante_urls:
            comprovante_urls.insert(0, meta.get("comprovante_url"))

        comprovante_urls_db = anexos_map.get(first_launch.id, [])
        for url in comprovante_urls_db:
            if url not in comprovante_urls:
                comprovante_urls.append(url)
        
        comprovante_url = comprovante_urls[0] if comprovante_urls else None

        # Build description with items and payment methods summary
        itens_list = meta.get("itens", [])
        if itens_list:
            desc_itens = ", ".join(f"{it.get('nome')} x{it.get('quantidade')}" for it in itens_list)
        else:
            desc_itens = first_launch.descricao

        pagamentos_list = meta.get("pagamentos", [])
        if pagamentos_list:
            desc_pag = " + ".join(f"{p.get('tipo_pagamento').replace('_', ' ').title()}: R$ {p.get('valor'):.2f}" for p in pagamentos_list)
            descricao_completa = f"{desc_itens} [{desc_pag}]"
        else:
            descricao_completa = desc_itens

        if cliente:
            descricao_completa = f"{cliente} ({descricao_completa})"

        created_at = first_launch.created_at or datetime.utcnow()
        data_registro = first_launch.data_pagamento or first_launch.data_vencimento or created_at.date()
        rv_code = meta.get("rv", f"RV-{first_launch.id:06d}")

        consolidated_items.append({
            "id": first_launch.id,
            "venda_id_uuid": venda_id if not str(venda_id).startswith("legacy-") else None,
            "rv": rv_code,
            "data": data_registro,
            "hora": created_at.strftime("%H:%M"),
            "vendedor": venda_vendedores[venda_id],
            "vendedor_id": first_launch.created_by_id,
            "status": sale_status,
            "descricao": descricao_completa,
            "valor": valor_venda,
            "origem": first_launch.origem,
            "comprovante_url": comprovante_url,
            "comprovante_urls": comprovante_urls,
            "entidade_id": first_launch.entidade_id or meta.get("entidade_id"),
            "centro_custo_id": first_launch.centro_custo_id or meta.get("centro_custo_id"),
            "desconto": Decimal(str(meta.get("desconto") or 0)),
            "observacao_texto": meta.get("observacao_texto"),
            "itens_detalhe": meta.get("itens", []),
            "pagamentos_detalhe": meta.get("pagamentos", []),
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
    pode_ver_todas = "*" in permissions or PdvPermission.PDV_VER_TODAS_VENDAS.value in permissions
    if not pode_ver_todas and venda_in.vendedor_id != current_user.id:
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
    return PdvService.atualizar_venda(
        db=db,
        venda_id=venda_id,
        venda_in=venda_in,
        empresa_id=empresa_id,
        current_user_id=int(current_user.id or 0)
    )

@router.patch("/vendas/{venda_id}/status", status_code=200)
def atualizar_status_venda_pdv(
    venda_id: str,
    status_in: str = Query(..., description="Novo status da venda: REALIZADO, CANCELADO, DEVOLVIDO"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza o status de todos os lançamentos que compartilham o mesmo UUID de venda."""
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

    novo_status = status_in.upper()
    if novo_status not in ["REALIZADO", "CANCELADO", "DEVOLVIDO"]:
        raise HTTPException(status_code=400, detail="Status inválido.")

    # Carregar configurações do PDV
    empresa = db.get(Empresa, empresa_id)
    pdv_config_dict = {}
    if empresa and empresa.pdv_config:
        try:
            pdv_config_dict = json.loads(empresa.pdv_config)
        except Exception:
            pass
    config_marcar_como_pago = pdv_config_dict.get("marcar_como_pago", {})

    hoje = datetime.utcnow().date()

    for l in launches:
        meta = {}
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
            except Exception:
                pass
        
        meta["status"] = novo_status
        l.observacao = json.dumps(meta)

        if novo_status == "REALIZADO":
            tipo_pag = meta.get("tipo_pagamento", "dinheiro")
            is_paid = config_marcar_como_pago.get(
                tipo_pag, 
                tipo_pag in ["dinheiro", "pix_chave", "pix_qr", "cartao_credito_vista"]
            )
            
            if is_paid:
                l.status = "PAGO"
                l.data_pagamento = hoje
                l.valor_pago = l.valor_previsto
                if not l.conta_id:
                    l.conta_id = obter_conta_caixa_fisica(db, empresa_id)
            else:
                l.status = "EM ABERTO"
                l.data_pagamento = None
                l.valor_pago = Decimal("0.00")
        else: # CANCELADO ou DEVOLVIDO
            # Para manter consistência financeira, lançamentos cancelados no PDV têm status 'CANCELADO'
            # e zeram valor_pago para não distorcer o fluxo de caixa
            l.status = novo_status
            l.data_pagamento = None
            l.valor_pago = Decimal("0.00")
            
        l.updated_by_id = current_user.id
        l.updated_at = datetime.utcnow()
        db.add(l)

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
    """Lista todos os recebíveis de cartão previstos/recebidos da empresa (Agenda de Recebíveis)."""
    query = (
        select(Lancamento, Usuario, Entidade)
        .join(Usuario, Usuario.id == Lancamento.created_by_id, isouter=True)
        .join(Entidade, Entidade.id == Lancamento.entidade_id, isouter=True)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA",
            Lancamento.origem == "PDV",
            or_(
                Lancamento.observacao.is_(None),
                ~Lancamento.observacao.ilike('%"legacy_id_venda"%')
            )
        )
    )
    if start_date:
        query = query.where(Lancamento.data_vencimento >= start_date)
    if end_date:
        query = query.where(Lancamento.data_vencimento <= end_date)
        
    rows = db.exec(query).all()
    
    recebiveis = []
    for l, vendedor, cliente in rows:
        if not l.observacao:
            continue
        try:
            meta = json.loads(l.observacao)
        except Exception:
            continue
            
        tipo_pag = meta.get("tipo_pagamento", "")
        if not (tipo_pag.startswith("cartao_") or "cartao" in tipo_pag):
            continue
            
        status_l = "PAGO" if l.status == "PAGO" else "A RECEBER"
        
        taxa_perc = Decimal(str(meta.get("cartao_taxa", 0.0)))
        valor_bruto = l.valor_previsto
        valor_taxa = Decimal(str(meta.get("cartao_taxa_valor", 0.0)))
        if not meta.get("cartao_taxa_valor") and taxa_perc > 0:
            valor_taxa = (valor_bruto * taxa_perc / 100).quantize(Decimal("0.01"))
            
        valor_liquido = Decimal(str(meta.get("cartao_liquido_previsto", float(valor_bruto - valor_taxa))))
        
        recebiveis.append({
            "id": l.id,
            "venda_id_uuid": l.id_parcelamento,
            "rv": meta.get("rv", f"RV-{l.id:06d}"),
            "data_venda": l.data_competencia or (l.created_at.date() if l.created_at else date.today()),
            "data_vencimento": l.data_vencimento,
            "descricao": l.descricao,
            "tipo_pagamento": tipo_pag,
            "bandeira": meta.get("bandeira", "OUTROS").upper(),
            "numero_parcela": meta.get("numero_parcela"),
            "total_parcelas": meta.get("total_parcelas"),
            "valor_bruto": valor_bruto,
            "valor_taxa": valor_taxa,
            "valor_liquido": valor_liquido,
            "status": status_l,
            "vendedor": (vendedor.nome or vendedor.email) if vendedor else "Sem vendedor",
            "vendedor_id": l.created_by_id,
            "cliente": (cliente.nome or cliente.nome_fantasia or "Cliente Final") if cliente else "Cliente Final",
            "cliente_id": l.entidade_id,
            "itens": meta.get("itens", []),
            "conta_id": l.conta_id,
            "plano_contas_id": l.plano_contas_id
        })
        
    recebiveis.sort(key=lambda r: (r["data_vencimento"], r["id"]), reverse=True)
    return recebiveis


@router.post("/conciliacao/auto-match", status_code=200)
def auto_match_conciliacao(
    lancamento_deposito_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Retorna sugestões de recebíveis que correspondem ao valor creditado no extrato."""
    deposito = db.get(Lancamento, lancamento_deposito_id)
    if not deposito or deposito.empresa_id != empresa_id or deposito.is_deleted:
        raise HTTPException(status_code=404, detail="Lançamento de depósito não encontrado.")
    
    valor_deposito = deposito.valor_pago if deposito.valor_pago > 0 else deposito.valor_previsto
    if not valor_deposito or valor_deposito <= 0:
        raise HTTPException(status_code=400, detail="Lançamento de depósito tem valor zerado ou inválido.")
        
    data_deposito = deposito.data_pagamento or deposito.data_vencimento
    if not data_deposito:
        data_deposito = deposito.created_at.date() if deposito.created_at else date.today()

    from datetime import timedelta
    launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA",
            Lancamento.origem == "PDV",
            Lancamento.status == "EM ABERTO",
            Lancamento.data_vencimento >= data_deposito - timedelta(days=7),
            Lancamento.data_vencimento <= data_deposito + timedelta(days=7),
            or_(
                Lancamento.observacao.is_(None),
                ~Lancamento.observacao.ilike('%"legacy_id_venda"%')
            )
        )
    ).all()
    
    recebiveis_abertos = []
    for l in launches:
        if not l.observacao:
            continue
        try:
            meta = json.loads(l.observacao)
        except Exception:
            continue
        
        tipo_pag = meta.get("tipo_pagamento", "")
        if not (tipo_pag.startswith("cartao_") or "cartao" in tipo_pag):
            continue
            
        taxa_perc = Decimal(str(meta.get("cartao_taxa", 0.0)))
        valor_bruto = l.valor_previsto
        valor_taxa = Decimal(str(meta.get("cartao_taxa_valor", 0.0)))
        if not meta.get("cartao_taxa_valor") and taxa_perc > 0:
            valor_taxa = (valor_bruto * taxa_perc / 100).quantize(Decimal("0.01"))
        valor_liquido = Decimal(str(meta.get("cartao_liquido_previsto", float(valor_bruto - valor_taxa))))
        
        recebiveis_abertos.append({
            "id": l.id,
            "data_vencimento": l.data_vencimento or l.data_competencia,
            "bandeira": meta.get("bandeira", "OUTROS").upper(),
            "valor_bruto": valor_bruto,
            "valor_taxa": valor_taxa,
            "valor_liquido": valor_liquido,
            "descricao": l.descricao,
            "numero_parcela": meta.get("numero_parcela"),
            "total_parcelas": meta.get("total_parcelas")
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
    for dt, itens in defaultdict(list).items():
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
    """Cria o lote de cartão, liquida os recebíveis e lança a despesa de taxas adquirentes correspondente."""
    # 1. Carregar e validar lançamentos de cartão
    if not lote_in.lancamento_ids:
        raise HTTPException(status_code=400, detail="Nenhum lançamento informado para conciliação.")
        
    recebiveis = db.exec(
        select(Lancamento)
        .where(
            Lancamento.id.in_(lote_in.lancamento_ids),
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
    ).all()
    
    if len(recebiveis) != len(lote_in.lancamento_ids):
        raise HTTPException(status_code=400, detail="Um ou mais lançamentos informados são inválidos ou não pertencem à empresa.")

    for r in recebiveis:
        if r.status == "PAGO":
            raise HTTPException(status_code=400, detail=f"Lançamento ID {r.id} já está pago/conciliado.")

    # 2. Validar conta destino
    conta = db.get(Conta, lote_in.conta_destino_id)
    if not conta or conta.empresa_id != empresa_id:
        raise HTTPException(status_code=400, detail="Conta destino inválida.")

    # 3. Calcular somas
    total_bruto = Decimal("0.00")
    total_taxa = Decimal("0.00")
    total_liquido = Decimal("0.00")
    
    primeira_regra_id = None
    regra = None
    
    for r in recebiveis:
        total_bruto += r.valor_previsto
        
        # Obter taxa da observação
        taxa_valor = Decimal("0.00")
        if r.observacao:
            try:
                meta = json.loads(r.observacao)
                taxa_valor = Decimal(str(meta.get("cartao_taxa_valor", 0.0)))
                if not primeira_regra_id and meta.get("cartao_regra_id"):
                    primeira_regra_id = int(meta.get("cartao_regra_id"))
            except Exception:
                pass
        
        total_taxa += taxa_valor
        total_liquido += (r.valor_previsto - taxa_valor)

    if primeira_regra_id:
        regra = db.get(RegraCartao, primeira_regra_id)
        print("DEBUG RECONCILIATION: regra found =", regra)
        if regra:
            print("DEBUG RECONCILIATION: regra.plano_contas_taxa_id =", regra.plano_contas_taxa_id)
    else:
        print("DEBUG RECONCILIATION: primeira_regra_id is None")

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
    db.flush()  # Gerar ID do lote

    # 5. Criar itens do lote e liquidar os recebíveis
    for r in recebiveis:
        taxa_valor = Decimal("0.00")
        if r.observacao:
            try:
                meta = json.loads(r.observacao)
                taxa_valor = Decimal(str(meta.get("cartao_taxa_valor", 0.0)))
            except Exception:
                pass
                
        item = LoteCartaoItem(
            lote_cartao_id=lote.id,
            lancamento_id=r.id,
            valor_bruto=r.valor_previsto,
            valor_taxa=taxa_valor,
            valor_liquido=r.valor_previsto - taxa_valor
        )
        db.add(item)
        
        # Liquidar o recebível de cartão como PAGO
        r.status = "PAGO"
        r.data_pagamento = lote_in.data_pagamento
        r.valor_pago = r.valor_previsto  # Receita bruta
        r.conta_id = lote_in.conta_destino_id
        r.conciliado = True
        r.updated_by_id = current_user.id
        r.updated_at = datetime.utcnow()
        db.add(r)

    # 6. Lançar a despesa de taxas adquirentes correspondente
    if total_taxa > 0:
        # Encontrar plano de contas de taxa adequado
        plano_taxa_id = None
        if regra and regra.plano_contas_taxa_id:
            plano_taxa_id = regra.plano_contas_taxa_id
        else:
            plano_despesa = db.exec(
                select(PlanoContas)
                .where(
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.tipo == "D",
                    PlanoContas.eh_cabecalho == False,
                    PlanoContas.is_deleted == False
                )
            ).all()
            print("DEBUG RECONCILIATION: plano_despesa count =", len(plano_despesa))
            for pd in plano_despesa:
                print(f"DEBUG RECONCILIATION: item id={pd.id} nome={pd.nome} tipo={pd.tipo} eh_cabecalho={pd.eh_cabecalho} is_deleted={pd.is_deleted}")
                if "taxa" in (pd.nome or "").lower() or "financeir" in (pd.nome or "").lower():
                    plano_taxa_id = pd.id
                    break
            if not plano_taxa_id and plano_despesa:
                plano_taxa_id = plano_despesa[0].id

        if not plano_taxa_id:
            raise HTTPException(status_code=400, detail="Nenhuma categoria de despesa financeira ou taxa cadastrada no plano de contas.")

        despesa_taxa = Lancamento(
            descricao=f"Taxa de Adm. Cartão Lote #{lote.id}",
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
            empresa_id=empresa_id,
            plano_contas_id=plano_taxa_id,
            conta_id=lote_in.conta_destino_id,
            created_by_id=current_user.id,
            updated_by_id=current_user.id,
            observacao=json.dumps({"lote_cartao_id": lote.id, "conciliacao_taxa": True}),
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
            dep_entry.valor_pago = dep_entry.valor_previsto
            dep_entry.updated_by_id = current_user.id
            dep_entry.updated_at = datetime.utcnow()
            db.add(dep_entry)

    db.commit()
    db.refresh(lote)
    
    # Preencher itens associados para o schema de leitura
    db_items = db.exec(
        select(LoteCartaoItem)
        .where(LoteCartaoItem.lote_cartao_id == lote.id)
    ).all()
    
    itens_read = []
    for item in db_items:
        r_db = db.get(Lancamento, item.lancamento_id)
        itens_read.append(
            LoteCartaoItemRead(
                id=item.id,
                lote_cartao_id=item.lote_cartao_id,
                lancamento_id=item.lancamento_id,
                valor_bruto=item.valor_bruto,
                valor_taxa=item.valor_taxa,
                valor_liquido=item.valor_liquido,
                descricao_venda=r_db.descricao if r_db else None,
                data_venda=r_db.data_competencia if r_db else None
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
    
    itens_read = []
    for item in db_items:
        r_db = db.get(Lancamento, item.lancamento_id)
        itens_read.append(
            LoteCartaoItemRead(
                id=item.id,
                lote_cartao_id=item.lote_cartao_id,
                lancamento_id=item.lancamento_id,
                valor_bruto=item.valor_bruto,
                valor_taxa=item.valor_taxa,
                valor_liquido=item.valor_liquido,
                descricao_venda=r_db.descricao if r_db else None,
                data_venda=r_db.data_competencia if r_db else None
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
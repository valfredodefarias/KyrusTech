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
from sqlmodel import Session, select, col

from app.api.v1.deps import get_current_active_user, get_empresa_id_from_user
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
from app.schemas.pdv import (
    PdvVendaGrupoRead,
    PdvVendaItemRead,
    PdvVendasRead,
    ProdutoRead,
    ProdutoCreate,
    ProdutoUpdate,
    PdvVendaCreate,
    PdvVendaPagamento
)
from app.services.access_control_service import get_effective_permission_codes
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


def obter_conta_caixa_fisica(db: Session, empresa_id: int) -> int:
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    # 1. Tipo CAIXA e nome contendo "caixa" ou "física"
    for c in contas:
        if c.tipo.upper() == "CAIXA" and "caixa" in c.nome.lower():
            return c.id
    # 2. Tipo CAIXA
    for c in contas:
        if c.tipo.upper() == "CAIXA":
            return c.id
    # 3. Nome contendo "caixa"
    for c in contas:
        if "caixa" in c.nome.lower():
            return c.id
    # 4. Criar conta padrão se nenhuma existir
    nova_conta = Conta(
        nome="Caixa Física",
        tipo="CAIXA",
        saldo_inicial=Decimal("0.00"),
        status="ATIVO",
        empresa_id=empresa_id,
        conta_como_disponibilidade=True
    )
    db.add(nova_conta)
    db.flush()
    return nova_conta.id


@router.get("/vendas", response_model=PdvVendasRead)
def listar_vendas_pdv(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
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
        .order_by(Lancamento.created_at.desc(), Lancamento.id.desc())  # type: ignore
    )

    if not pode_ver_todas:
        query = query.where(Lancamento.created_by_id == current_user.id)

    rows = db.exec(query).all()

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
    )


# --- Rotas para Produtos do PDV ---

@router.get("/produtos", response_model=list[ProdutoRead])
def listar_produtos_pdv(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Retorna a lista de produtos ativos cadastrados para a empresa."""
    return db.exec(
        select(Produto)
        .where(Produto.empresa_id == empresa_id, Produto.is_deleted == False)
        .order_by(Produto.nome)
    ).all()


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
        empresa_id=empresa_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(produto)
    db.commit()
    db.refresh(produto)
    return produto


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
        
    produto.updated_by_id = current_user.id
    produto.updated_at = datetime.utcnow()
    db.add(produto)
    db.commit()
    db.refresh(produto)
    return produto


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


# --- Rota para Criar Venda Itemizada no PDV ---

@router.post("/vendas", response_model=PdvVendaItemRead, status_code=201)
def criar_venda_pdv(
    venda_in: PdvVendaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Registra uma nova venda itemizada no PDV, criando os respectivos lançamentos financeiros."""
    # 1. Validar se o vendedor_id pertence à mesma empresa
    vendedor = db.get(Usuario, venda_in.vendedor_id)
    if not vendedor or vendedor.empresa_id != empresa_id or vendedor.is_deleted:
        raise HTTPException(status_code=400, detail="Vendedor inválido para esta empresa.")
        
    # 1.2 Validar se o cliente (entidade_id) pertence à mesma empresa
    entidade = db.get(Entidade, venda_in.entidade_id)
    if not entidade or entidade.empresa_id != empresa_id:
        raise HTTPException(status_code=400, detail="Cliente inválido.")

    # 1.3 Validar se o centro de custo pertence à mesma empresa
    centro_custo = db.get(CentroCusto, venda_in.centro_custo_id)
    if not centro_custo or centro_custo.empresa_id != empresa_id:
        raise HTTPException(status_code=400, detail="Centro de custo inválido.")

    # 1.4 Validar se o Registro de Venda (RV) customizado já está em uso (não deletado)
    if venda_in.rv:
        rv_stripped = venda_in.rv.strip()
        existing = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                col(Lancamento.observacao).like(f'%"{rv_stripped}"%')
            )
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"O Registro de Venda (RV) '{rv_stripped}' já está em uso.")

    # 2. Restringir indicação de outro vendedor apenas a quem tem permissão de ver todas as vendas (gerente)
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
        
    # 3. Buscar e calcular valores dos itens do produto
    total_itens = Decimal("0.00")
    descricao_itens = []
    itens_metadados = []
    
    product_ids = [item.produto_id for item in venda_in.itens if item.produto_id is not None]
    produtos_map = {}
    if product_ids:
        produtos = db.exec(select(Produto).where(Produto.id.in_(product_ids))).all()
        produtos_map = {p.id: p for p in produtos if p.id is not None}
        
    for item in venda_in.itens:
        produto = produtos_map.get(item.produto_id)
        if not produto or produto.empresa_id != empresa_id or produto.is_deleted:
            raise HTTPException(status_code=400, detail=f"Produto ID {item.produto_id} inválido.")
        
        # Override price if provided (primarily for services)
        preco_usado = produto.preco_unitario
        if item.preco_unitario is not None and produto.tipo == "SERVICO":
            preco_usado = item.preco_unitario

        sa_val = preco_usado * Decimal(item.quantidade)
        total_itens += sa_val
        item_desconto = item.desconto if item.desconto is not None else Decimal("0.00")
        descricao_itens.append(f"{produto.nome} x{item.quantidade}")
        itens_metadados.append({
            "produto_id": produto.id,
            "nome": produto.nome,
            "quantidade": item.quantidade,
            "preco_unitario": float(preco_usado),
            "desconto": float(item_desconto),
            "subtotal": float(sa_val)
        })
        
    # 4. Calcular valor final líquido
    valor_final_venda = total_itens - venda_in.desconto
    if valor_final_venda < 0:
        raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o subtotal da venda.")

    # Validar se a soma dos pagamentos corresponde ao valor final líquido
    total_pagamentos = sum(Decimal(p.valor) for p in venda_in.pagamentos)
    if abs(total_pagamentos - valor_final_venda) > Decimal("0.05"):
        raise HTTPException(
            status_code=400,
            detail=f"A soma dos pagamentos (R$ {total_pagamentos:.2f}) não condiz com o valor líquido da venda (R$ {valor_final_venda:.2f})."
        )
        
    # 5. Encontrar plano de contas padrão de receita ativo (para fallbacks)
    plano_fallback = db.exec(
        select(PlanoContas)
        .where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "R",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.is_deleted == False
        )
    ).first()
    if not plano_fallback:
        raise HTTPException(
            status_code=400,
            detail="Não há categoria de receitas ativa configurada no plano de contas da empresa."
        )
    plano_fallback_id = int(plano_fallback.id)

    # 6. Carregar configurações do PDV da empresa
    empresa = db.get(Empresa, empresa_id)
    pdv_config_dict = {}
    if empresa and empresa.pdv_config:
        try:
            pdv_config_dict = json.loads(empresa.pdv_config)
        except Exception:
            pass
    config_categorias = pdv_config_dict.get("categorias", {})
    config_marcar_como_pago = pdv_config_dict.get("marcar_como_pago", {})
    config_contas = pdv_config_dict.get("contas", {})
    
    pdv_venda_id = str(uuid.uuid4())
    sale_status = venda_in.status.upper()
    
    # Montar observação estruturada básica
    descricao_geral = ", ".join(descricao_itens)
    pagamentos_metadados = []
    for p in venda_in.pagamentos:
        pagamentos_metadados.append({
            "tipo_pagamento": p.tipo_pagamento,
            "valor": float(p.valor),
            "numero_parcelas": p.numero_parcelas,
            "valor_parcela": float(p.valor_parcela) if p.valor_parcela else None,
            "data_pagamento": str(p.data_pagamento) if p.data_pagamento else None
        })

    dados_observacao_base = {
        "pdv_venda": True,
        "pdv_venda_id": pdv_venda_id,
        "cliente": entidade.nome,
        "entidade_id": venda_in.entidade_id,
        "centro_custo_id": venda_in.centro_custo_id,
        "observacao_texto": venda_in.observacao,
        "subtotal": float(total_itens),
        "desconto": float(venda_in.desconto),
        "status": sale_status,
        "itens": itens_metadados,
        "pagamentos": pagamentos_metadados,
        "comprovante_url": None,
        "comprovante_urls": []
    }
    
    launches_created = []
    desconto_ja_atribuido = False

    # 7. Criar os lançamentos financeiros correspondentes a cada pagamento
    for p in venda_in.pagamentos:
        # Categoria para esse método
        plano_id = int(config_categorias.get(p.tipo_pagamento) or plano_fallback_id)
        # Conta para esse método
        conta_id_str = config_contas.get(p.tipo_pagamento)
        conta_id = int(conta_id_str) if conta_id_str else None

        # Data de pagamento customizada da linha, caindo de volta para a data geral da venda ou hoje
        hoje_pag = p.data_pagamento if p.data_pagamento else (venda_in.data_pagamento if venda_in.data_pagamento else datetime.utcnow().date())

        # Liquidado ou em aberto?
        if sale_status == "ORCAMENTO":
            is_paid = False
        else:
            is_paid = config_marcar_como_pago.get(
                p.tipo_pagamento,
                p.tipo_pagamento in ["dinheiro", "pix_chave", "pix_qr", "cartao_credito_vista"]
            )

        if is_paid and not conta_id:
            conta_id = obter_conta_caixa_fisica(db, empresa_id)

        # Verificar se a forma de pagamento aceita parcelamento
        is_parcelada = False
        formas_config = pdv_config_dict.get("formas_pagamento", [])
        matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
        if matched_forma:
            is_parcelada = matched_forma.get("parcelada", False)
        else:
            is_parcelada = p.tipo_pagamento in ["cartao_credito_parcelado", "boleto"]

        if is_parcelada and p.numero_parcelas and p.numero_parcelas > 1:
            # Installment-based payment
            num_parc = int(p.numero_parcelas)
            total_pag = Decimal(p.valor)
            base_val = (total_pag / num_parc).quantize(Decimal("0.01"))
            last_val = total_pag - (base_val * (num_parc - 1))

            for i in range(1, num_parc + 1):
                # Calculate consecutive monthly vencimento dates (starting 1 month from today)
                year = hoje_pag.year + (hoje_pag.month - 1 + i) // 12
                month = (hoje_pag.month - 1 + i) % 12 + 1
                day = min(hoje_pag.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
                vencimento = date(year, month, day)

                valor_linha = base_val if i < num_parc else last_val
                
                obs_data = dados_observacao_base.copy()
                obs_data["tipo_pagamento"] = p.tipo_pagamento
                obs_data["numero_parcela"] = i
                obs_data["total_parcelas"] = num_parc

                l = Lancamento(
                    descricao=f"Venda RV-AUTOGERADO ({i}/{num_parc}) - {descricao_geral[:150]}",
                    tipo="RECEITA",
                    status="PAGO" if is_paid else "EM ABERTO",
                    origem="PDV",
                    valor_previsto=valor_linha,
                    valor_pago=valor_linha if is_paid else Decimal("0.00"),
                    valor_juros=Decimal("0.00"),
                    valor_desconto=Decimal("0.00") if desconto_ja_atribuido or i > 1 else venda_in.desconto,  # toda na 1a parcela
                    valor_multa=Decimal("0.00"),
                    data_vencimento=vencimento,
                    data_pagamento=hoje_pag if is_paid else None,
                    data_competencia=hoje_pag,
                    empresa_id=empresa_id,
                    plano_contas_id=plano_id,
                    conta_id=conta_id,
                    entidade_id=venda_in.entidade_id,
                    centro_custo_id=venda_in.centro_custo_id,
                    created_by_id=venda_in.vendedor_id,
                    updated_by_id=current_user.id,
                    observacao=json.dumps(obs_data),
                    is_deleted=False,
                    ipp=False,
                    previsto=True,
                    conciliado=False,
                    numero_parcela=i,
                    id_parcelamento=pdv_venda_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(l)
                launches_created.append(l)
            desconto_ja_atribuido = True
        else:
            # Single payment
            obs_data = dados_observacao_base.copy()
            obs_data["tipo_pagamento"] = p.tipo_pagamento

            l = Lancamento(
                descricao=f"Venda RV-AUTOGERADO - {descricao_geral[:200]}",
                tipo="RECEITA",
                status="PAGO" if is_paid else "EM ABERTO",
                origem="PDV",
                valor_previsto=p.valor,
                valor_pago=p.valor if is_paid else Decimal("0.00"),
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00") if desconto_ja_atribuido else venda_in.desconto,
                valor_multa=Decimal("0.00"),
                data_vencimento=hoje_pag,
                data_pagamento=hoje_pag if is_paid else None,
                data_competencia=hoje_pag,
                empresa_id=empresa_id,
                plano_contas_id=plano_id,
                conta_id=conta_id,
                entidade_id=venda_in.entidade_id,
                centro_custo_id=venda_in.centro_custo_id,
                created_by_id=venda_in.vendedor_id,
                updated_by_id=current_user.id,
                observacao=json.dumps(obs_data),
                is_deleted=False,
                ipp=False,
                previsto=True,
                conciliado=False,
                id_parcelamento=pdv_venda_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(l)
            launches_created.append(l)
            desconto_ja_atribuido = True

    # 8. Flush e commit para gerar IDs e atualizar com código de RV definitivo
    db.flush()
    
    first_launch = launches_created[0]
    rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{first_launch.id:06d}"
    
    for l in launches_created:
        l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
        meta = json.loads(l.observacao)
        meta["rv"] = rv_code
        l.observacao = json.dumps(meta)
        db.add(l)
        
    db.commit()
    db.refresh(first_launch)

    # Pegamos a data_registro com base na data do primeiro lançamento
    data_registro = first_launch.data_pagamento or first_launch.data_vencimento or hoje_pag

    return PdvVendaItemRead(
        id=int(first_launch.id or 0),
        rv=rv_code,
        data=data_registro,
        hora=datetime.utcnow().strftime("%H:%M"),
        vendedor=(vendedor.nome or vendedor.email),
        status=sale_status,
        descricao=first_launch.descricao,
        valor=valor_final_venda,
        venda_id_uuid=pdv_venda_id,
        comprovante_url=None,
        comprovante_urls=[]
    )

@router.put("/vendas/{venda_id}", response_model=PdvVendaItemRead)
def atualizar_venda_pdv(
    venda_id: str,
    venda_in: PdvVendaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza uma venda existente substituindo seus lançamentos pelos novos informados."""
    # 1. Validar se a venda existe
    launches_antigos = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            Lancamento.id_parcelamento == venda_id
        )
    ).all()
    if not launches_antigos:
        raise HTTPException(status_code=404, detail="Venda não encontrada.")

    # 2. Validar vendedor, cliente e centro de custo
    vendedor = db.get(Usuario, venda_in.vendedor_id)
    if not vendedor or vendedor.empresa_id != empresa_id or vendedor.is_deleted:
        raise HTTPException(status_code=400, detail="Vendedor inválido para esta empresa.")
        
    entidade = db.get(Entidade, venda_in.entidade_id)
    if not entidade or entidade.empresa_id != empresa_id:
        raise HTTPException(status_code=400, detail="Cliente inválido.")

    centro_custo = db.get(CentroCusto, venda_in.centro_custo_id)
    if not centro_custo or centro_custo.empresa_id != empresa_id:
        raise HTTPException(status_code=400, detail="Centro de custo inválido.")

    # 3. Se um novo RV customizado for enviado e for diferente do atual, validar se já está em uso
    rv_antigo = None
    for l in launches_antigos:
        if l.observacao:
            try:
                meta_l = json.loads(l.observacao)
                rv_antigo = meta_l.get("rv")
                break
            except Exception:
                pass
    
    if venda_in.rv and venda_in.rv.strip() != rv_antigo:
        rv_stripped = venda_in.rv.strip()
        existing = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.id_parcelamento != venda_id,
                col(Lancamento.observacao).like(f'%"{rv_stripped}"%')
            )
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"O Registro de Venda (RV) '{rv_stripped}' já está em uso.")

    # 4. Calcular novos valores
    total_itens = Decimal("0.00")
    descricao_itens = []
    itens_metadados = []
    
    product_ids = [item.produto_id for item in venda_in.itens if item.produto_id is not None]
    produtos_map = {}
    if product_ids:
        produtos = db.exec(select(Produto).where(Produto.id.in_(product_ids))).all()
        produtos_map = {p.id: p for p in produtos if p.id is not None}
        
    for item in venda_in.itens:
        produto = produtos_map.get(item.produto_id)
        if not produto or produto.empresa_id != empresa_id or produto.is_deleted:
            raise HTTPException(status_code=400, detail=f"Produto ID {item.produto_id} inválido.")
        
        # Override price if provided (primarily for services)
        preco_usado = produto.preco_unitario
        if item.preco_unitario is not None and produto.tipo == "SERVICO":
            preco_usado = item.preco_unitario

        sa_val = preco_usado * Decimal(item.quantidade)
        total_itens += sa_val
        item_desconto = item.desconto if item.desconto is not None else Decimal("0.00")
        descricao_itens.append(f"{produto.nome} x{item.quantidade}")
        itens_metadados.append({
            "produto_id": produto.id,
            "nome": produto.nome,
            "quantidade": item.quantidade,
            "preco_unitario": float(preco_usado),
            "desconto": float(item_desconto),
            "subtotal": float(sa_val)
        })
        
    valor_final_venda = total_itens - venda_in.desconto
    if valor_final_venda < 0:
        raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o subtotal da venda.")

    total_pagamentos = sum(Decimal(p.valor) for p in venda_in.pagamentos)
    if abs(total_pagamentos - valor_final_venda) > Decimal("0.05"):
        raise HTTPException(
            status_code=400,
            detail=f"A soma dos pagamentos (R$ {total_pagamentos:.2f}) não condiz com o valor líquido da venda (R$ {valor_final_venda:.2f})."
        )
        
    plano_fallback = db.exec(
        select(PlanoContas)
        .where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == "R",
            PlanoContas.eh_cabecalho == False,
            PlanoContas.is_deleted == False
        )
    ).first()
    if not plano_fallback:
        raise HTTPException(status_code=400, detail="Não há categoria de receitas ativa configurada no plano de contas da empresa.")
    plano_fallback_id = int(plano_fallback.id)

    # 5. Carregar configurações do PDV da empresa
    empresa = db.get(Empresa, empresa_id)
    pdv_config_dict = {}
    if empresa and empresa.pdv_config:
        try:
            pdv_config_dict = json.loads(empresa.pdv_config)
        except Exception:
            pass
    config_categorias = pdv_config_dict.get("categorias", {})
    config_marcar_como_pago = pdv_config_dict.get("marcar_como_pago", {})
    config_contas = pdv_config_dict.get("contas", {})

    # 6. Carregar anexos antigos para reassociá-los aos novos lançamentos
    old_launch_ids = [l.id for l in launches_antigos if l.id is not None]
    old_anexos = []
    if old_launch_ids:
        old_anexos = db.exec(
            select(AnexoLancamento)
            .where(
                AnexoLancamento.lancamento_id.in_(old_launch_ids),
                AnexoLancamento.empresa_id == empresa_id,
                AnexoLancamento.is_deleted == False
            )
        ).all()

    old_comprovante_url = None
    old_comprovante_urls = []
    for l in launches_antigos:
        if l.observacao:
            try:
                meta_l = json.loads(l.observacao)
                if meta_l.get("comprovante_url"):
                    old_comprovante_url = meta_l.get("comprovante_url")
                if meta_l.get("comprovante_urls"):
                    old_comprovante_urls = meta_l.get("comprovante_urls")
            except Exception:
                pass

    if old_comprovante_url and old_comprovante_url not in old_comprovante_urls:
        old_comprovante_urls.insert(0, old_comprovante_url)

    if venda_in.comprovante_urls is not None:
        old_comprovante_urls = [url for url in old_comprovante_urls if url in venda_in.comprovante_urls]
        old_comprovante_url = old_comprovante_urls[0] if old_comprovante_urls else None

    # Marcar lançamentos antigos como deletados (exclusão lógica)
    for l in launches_antigos:
        l.is_deleted = True
        l.deleted_at = datetime.utcnow()
        l.deleted_by_id = current_user.id
        db.add(l)

    # 7. Criar os novos lançamentos com o mesmo venda_id (id_parcelamento)
    sale_status = venda_in.status.upper()
    
    descricao_geral = ", ".join(descricao_itens)
    pagamentos_metadados = []
    for p in venda_in.pagamentos:
        pagamentos_metadados.append({
            "tipo_pagamento": p.tipo_pagamento,
            "valor": float(p.valor),
            "numero_parcelas": p.numero_parcelas,
            "valor_parcela": float(p.valor_parcela) if p.valor_parcela else None,
            "data_pagamento": str(p.data_pagamento) if p.data_pagamento else None
        })

    dados_observacao_base = {
        "pdv_venda": True,
        "pdv_venda_id": venda_id,
        "cliente": entidade.nome,
        "entidade_id": venda_in.entidade_id,
        "centro_custo_id": venda_in.centro_custo_id,
        "observacao_texto": venda_in.observacao,
        "subtotal": float(total_itens),
        "desconto": float(venda_in.desconto),
        "status": sale_status,
        "itens": itens_metadados,
        "pagamentos": pagamentos_metadados,
        "comprovante_url": old_comprovante_url,
        "comprovante_urls": old_comprovante_urls
    }
    
    launches_created = []
    desconto_ja_atribuido = False

    for p in venda_in.pagamentos:
        plano_id = int(config_categorias.get(p.tipo_pagamento) or plano_fallback_id)
        conta_id_str = config_contas.get(p.tipo_pagamento)
        conta_id = int(conta_id_str) if conta_id_str else None

        # Data de pagamento customizada da linha, caindo de volta para a data geral da venda ou hoje
        hoje_pag = p.data_pagamento if p.data_pagamento else (venda_in.data_pagamento if venda_in.data_pagamento else datetime.utcnow().date())

        if sale_status == "ORCAMENTO":
            is_paid = False
        else:
            is_paid = config_marcar_como_pago.get(
                p.tipo_pagamento,
                p.tipo_pagamento in ["dinheiro", "pix_chave", "pix_qr", "cartao_credito_vista"]
            )

        if is_paid and not conta_id:
            conta_id = obter_conta_caixa_fisica(db, empresa_id)

        # Verificar se a forma de pagamento aceita parcelamento
        is_parcelada = False
        formas_config = pdv_config_dict.get("formas_pagamento", [])
        matched_forma = next((f for f in formas_config if f.get("key") == p.tipo_pagamento), None)
        if matched_forma:
            is_parcelada = matched_forma.get("parcelada", False)
        else:
            is_parcelada = p.tipo_pagamento in ["cartao_credito_parcelado", "boleto"]

        if is_parcelada and p.numero_parcelas and p.numero_parcelas > 1:
            num_parc = int(p.numero_parcelas)
            total_pag = Decimal(p.valor)
            base_val = (total_pag / num_parc).quantize(Decimal("0.01"))
            last_val = total_pag - (base_val * (num_parc - 1))

            for i in range(1, num_parc + 1):
                year = hoje_pag.year + (hoje_pag.month - 1 + i) // 12
                month = (hoje_pag.month - 1 + i) % 12 + 1
                day = min(hoje_pag.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
                vencimento = date(year, month, day)

                valor_linha = base_val if i < num_parc else last_val
                
                obs_data = dados_observacao_base.copy()
                obs_data["tipo_pagamento"] = p.tipo_pagamento
                obs_data["numero_parcela"] = i
                obs_data["total_parcelas"] = num_parc

                l = Lancamento(
                    descricao=f"Venda RV-AUTOGERADO ({i}/{num_parc}) - {descricao_geral[:150]}",
                    tipo="RECEITA",
                    status="PAGO" if is_paid else "EM ABERTO",
                    origem="PDV",
                    valor_previsto=valor_linha,
                    valor_pago=valor_linha if is_paid else Decimal("0.00"),
                    valor_juros=Decimal("0.00"),
                    valor_desconto=Decimal("0.00") if desconto_ja_atribuido or i > 1 else venda_in.desconto,
                    valor_multa=Decimal("0.00"),
                    data_vencimento=vencimento,
                    data_pagamento=hoje_pag if is_paid else None,
                    data_competencia=hoje_pag,
                    empresa_id=empresa_id,
                    plano_contas_id=plano_id,
                    conta_id=conta_id,
                    entidade_id=venda_in.entidade_id,
                    centro_custo_id=venda_in.centro_custo_id,
                    created_by_id=venda_in.vendedor_id,
                    updated_by_id=current_user.id,
                    observacao=json.dumps(obs_data),
                    is_deleted=False,
                    ipp=False,
                    previsto=True,
                    conciliado=False,
                    numero_parcela=i,
                    id_parcelamento=venda_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(l)
                launches_created.append(l)
            desconto_ja_atribuido = True
        else:
            obs_data = dados_observacao_base.copy()
            obs_data["tipo_pagamento"] = p.tipo_pagamento

            l = Lancamento(
                descricao=f"Venda RV-AUTOGERADO - {descricao_geral[:200]}",
                tipo="RECEITA",
                status="PAGO" if is_paid else "EM ABERTO",
                origem="PDV",
                valor_previsto=p.valor,
                valor_pago=p.valor if is_paid else Decimal("0.00"),
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00") if desconto_ja_atribuido else venda_in.desconto,
                valor_multa=Decimal("0.00"),
                data_vencimento=hoje_pag,
                data_pagamento=hoje_pag if is_paid else None,
                data_competencia=hoje_pag,
                empresa_id=empresa_id,
                plano_contas_id=plano_id,
                conta_id=conta_id,
                entidade_id=venda_in.entidade_id,
                centro_custo_id=venda_in.centro_custo_id,
                created_by_id=venda_in.vendedor_id,
                updated_by_id=current_user.id,
                observacao=json.dumps(obs_data),
                is_deleted=False,
                ipp=False,
                previsto=True,
                conciliado=False,
                id_parcelamento=venda_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(l)
            launches_created.append(l)
            desconto_ja_atribuido = True

    db.flush()
    first_launch = launches_created[0]
    rv_code = venda_in.rv.strip() if venda_in.rv and venda_in.rv.strip() else f"RV-{first_launch.id:06d}"
    
    # Reassociar os anexos antigos ao novo primeiro lançamento
    for an in old_anexos:
        if venda_in.comprovante_urls is not None and an.url not in venda_in.comprovante_urls:
            an.is_deleted = True
            an.deleted_at = datetime.utcnow()
            an.deleted_by_id = current_user.id
        else:
            an.lancamento_id = first_launch.id
        db.add(an)

    for l in launches_created:
        l.descricao = l.descricao.replace("RV-AUTOGERADO", rv_code)
        meta = json.loads(l.observacao)
        meta["rv"] = rv_code
        l.observacao = json.dumps(meta)
        db.add(l)
        
    db.commit()
    db.refresh(first_launch)

    data_registro = first_launch.data_pagamento or first_launch.data_vencimento or hoje_pag

    return PdvVendaItemRead(
        id=int(first_launch.id or 0),
        rv=rv_code,
        data=data_registro,
        hora=datetime.utcnow().strftime("%H:%M"),
        vendedor=(vendedor.nome or vendedor.email),
        status=sale_status,
        descricao=first_launch.descricao,
        valor=valor_final_venda,
        venda_id_uuid=venda_id,
        comprovante_url=old_comprovante_url,
        comprovante_urls=old_comprovante_urls
    )


# --- Rota para Atualizar Status da Venda no PDV ---

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
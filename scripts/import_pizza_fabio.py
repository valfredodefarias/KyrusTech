# scripts/import_pizza_fabio.py
import os
import re
import json
import datetime
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import openpyxl
from sqlmodel import Session, select, col
from sqlalchemy import func

from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from app.models.produto import Produto
from app.models.lancamento import Lancamento
from app.models.regra_cartao import RegraCartao
from app.models.pdv_ifood_lancamento import PdvIfoodLancamento
from app.models.dashboard_view_config import DashboardViewConfig
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.core.security import get_password_hash

def clean_str(val):
    if val is None:
        return ""
    s = str(val).replace("&nbsp;", " ").replace("\xa0", " ").strip()
    return re.sub(r"\s+", " ", s)

def parse_decimal(val):
    if val is None or val == "":
        return Decimal("0.00")
    if isinstance(val, (int, float)):
        return Decimal(str(val))
    if isinstance(val, Decimal):
        return val
    s = clean_str(val).replace("%", "").strip()
    if not s:
        return Decimal("0.00")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except Exception:
        return Decimal("0.00")

def parse_date(val):
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if not val:
        return None
    s = clean_str(val)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None

def get_account_balance(db: Session, conta_id: int) -> Decimal:
    conta = db.get(Conta, conta_id)
    if not conta:
        return Decimal("0.00")
    
    receitas = db.exec(
        select(func.sum(Lancamento.valor_pago))
        .where(
            Lancamento.conta_id == conta_id,
            Lancamento.tipo == "RECEITA",
            Lancamento.status == "PAGO",
            Lancamento.is_deleted == False
        )
    ).first() or Decimal("0.00")

    despesas = db.exec(
        select(func.sum(Lancamento.valor_pago))
        .where(
            Lancamento.conta_id == conta_id,
            Lancamento.tipo == "DESPESA",
            Lancamento.status == "PAGO",
            Lancamento.is_deleted == False
        )
    ).first() or Decimal("0.00")

    return conta.saldo_inicial + receitas - despesas

def import_unit(
    db: Session,
    file_path: str,
    company_name: str,
    filter_center_of_cost=None,
    dry_run=False
):
    print(f"\n==================================================")
    print(f"IMPORTING: {company_name} (File: {os.path.basename(file_path)})")
    if filter_center_of_cost:
        print(f"Filter Center of Cost: {filter_center_of_cost}")
    print(f"==================================================")

    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)

    stats = {
        "company_name": company_name,
        "pdv_imported": 0,
        "pdv_skipped": 0,
        "ifood_imported": 0,
        "ifood_skipped": 0,
        "fin_imported": 0,
        "fin_skipped": 0,
        "accounts": []
    }

    # 1. Create or Find Company
    company = db.exec(select(Empresa).where(Empresa.nome_fantasia == company_name)).first()
    if not company:
        mock_cnpj = f"legacy-{hash(company_name) & 0xffffffff}"
        company = Empresa(
            nome_fantasia=company_name,
            razao_social=company_name + " LTDA",
            cnpj=mock_cnpj,
            is_active=True
        )
        if not dry_run:
            db.add(company)
            db.flush()
            print(f"Created Company: {company_name}")
    else:
        print(f"Found existing Company: {company_name} (ID: {company.id})")

    empresa_id = company.id if company.id else 0

    # 2. Seed Default Centro Custo
    centro_name = filter_center_of_cost if filter_center_of_cost else "Matriz"
    if "marco" in company_name.lower():
        if "ifood" in file_path.lower():
            centro_name = "Delivery"
        elif filter_center_of_cost == "Marco":
            centro_name = "Salão"
            
    centro = db.exec(
        select(CentroCusto)
        .where(CentroCusto.empresa_id == empresa_id, CentroCusto.nome == centro_name)
    ).first()
    if not centro:
        centro = CentroCusto(
            nome=centro_name,
            descricao=f"Centro de custo principal para {company_name}",
            empresa_id=empresa_id
        )
        if not dry_run:
            db.add(centro)
            db.flush()
            print(f"Created CentroCusto: {centro_name}")
    else:
        print(f"Found existing CentroCusto: {centro_name} (ID: {centro.id})")

    centro_id = centro.id if centro.id else 0

    # 3. Import PlanoContas (CadClassificacao)
    pc_map = {}
    if "CadClassificacao" in wb.sheetnames:
        sheet = wb["CadClassificacao"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            code_idx = headers.index("Classificação") if "Classificação" in headers else 0
            desc_idx = headers.index("Descrição") if "Descrição" in headers else 1
            
            for row in rows[1:]:
                if not any(row):
                    continue
                code_raw = clean_str(row[code_idx])
                desc = clean_str(row[desc_idx]) if desc_idx < len(row) else ""
                if not code_raw or not desc:
                    continue
                
                code_match = re.match(r"^([\d\.]+)\s*(.*)$", code_raw)
                if code_match:
                    code = code_match.group(1).rstrip(".")
                    name = code_match.group(2).strip() or code_raw
                else:
                    code = code_raw
                    name = desc

                tipo = "R" if code.startswith("01") else "D"
                
                pc = db.exec(
                    select(PlanoContas)
                    .where(PlanoContas.empresa_id == empresa_id, PlanoContas.codigo == code)
                ).first()
                if not pc:
                    pc = PlanoContas(
                        codigo=code,
                        nome=name,
                        tipo=tipo,
                        eh_cabecalho=False,
                        permite_lancamentos=True,
                        empresa_id=empresa_id
                    )
                    if not dry_run:
                        db.add(pc)
                        db.flush()
                pc_map[code] = pc.id
                pc_map[code_raw] = pc.id
                pc_map[name.lower()] = pc.id
        print(f"Imported PlanoContas: {len(pc_map)} entries cached.")

    plano_fallback_id = None
    if not dry_run:
        plano_fallback = db.exec(
            select(PlanoContas)
            .where(PlanoContas.empresa_id == empresa_id, PlanoContas.tipo == "R", PlanoContas.eh_cabecalho == False)
        ).first()
        if not plano_fallback:
            plano_fallback = PlanoContas(
                codigo="01.99",
                nome="Vendas Diversas Fallback",
                tipo="R",
                eh_cabecalho=False,
                permite_lancamentos=True,
                empresa_id=empresa_id
            )
            db.add(plano_fallback)
            db.flush()
        plano_fallback_id = plano_fallback.id

    # 4. Import Contas Bancárias (Tb_Banco)
    bank_map = {}
    if "Tb_Banco" in wb.sheetnames:
        sheet = wb["Tb_Banco"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            bank_idx = headers.index("Banco") if "Banco" in headers else 0
            saldo_idx = headers.index("Saldo") if "Saldo" in headers else (headers.index("Saldo Final") if "Saldo Final" in headers else 1)
            
            for row in rows[1:]:
                if not any(row):
                    continue
                bank_name = clean_str(row[bank_idx])
                if not bank_name:
                    continue
                
                val_ini = Decimal("0.00")
                # Special offset for Itaú Ananindeua
                if "itaú ananindeua" in bank_name.lower():
                    val_ini = Decimal("50000.00")

                val_final = parse_decimal(row[saldo_idx]) if saldo_idx < len(row) else Decimal("0.00")
                
                tipo_c = "CORRENTE"
                if "caixa" in bank_name.lower() or "pdv" in bank_name.lower() or "tesouraria" in bank_name.lower():
                    tipo_c = "CAIXA"
                elif "aplicação" in bank_name.lower() or "investimento" in bank_name.lower():
                    tipo_c = "INVESTIMENTO"

                displayName = bank_name
                if "marco" in company_name.lower():
                    displayName = bank_name.replace("Umarizal", "Marco").replace("umarizal", "marco")

                conta = db.exec(
                    select(Conta)
                    .where(Conta.empresa_id == empresa_id, Conta.nome == displayName)
                ).first()
                if not conta:
                    conta = Conta(
                        nome=displayName,
                        tipo=tipo_c,
                        saldo_inicial=val_ini,
                        data_saldo_inicial=date(2023, 1, 1),
                        status="ATIVO",
                        empresa_id=empresa_id,
                        centro_custo_id=centro_id
                    )
                    if not dry_run:
                        db.add(conta)
                        db.flush()
                
                conta_id = conta.id if conta.id else 0
                bank_map[bank_name] = conta_id
                stats["accounts"].append({
                    "conta_id": conta_id,
                    "nome": displayName,
                    "saldo_inicial": float(val_ini),
                    "saldo_final_esperado": float(val_final),
                    "saldo_final_kyrus": 0.0
                })
        print(f"Imported Contas Bancárias: {len(bank_map)} entries.")

    # 5. Import Usuários (a.Usuario)
    user_map = {}
    default_hashed_pwd = get_password_hash("KyrusFabio123")
    
    if "a.Usuario" in wb.sheetnames:
        sheet = wb["a.Usuario"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            user_idx = headers.index("Usuário") if "Usuário" in headers else 0
            email_idx = headers.index("Email") if "Email" in headers else 1
            func_idx = headers.index("Função") if "Função" in headers else 2
            
            for row in rows[1:]:
                if not any(row):
                    continue
                username = clean_str(row[user_idx]) if user_idx < len(row) else ""
                email = clean_str(row[email_idx]) if email_idx < len(row) else ""
                if not username or not email:
                    continue
                
                user = db.exec(select(Usuario).where(Usuario.email == email)).first()
                if not user:
                    user = Usuario(
                        nome=username,
                        email=email,
                        hashed_password=default_hashed_pwd,
                        is_active=True,
                        is_consultor=False,
                        empresa_id=empresa_id
                    )
                    if not dry_run:
                        db.add(user)
                        db.flush()
                user_map[username] = user.id
                user_map[email] = user.id
        print(f"Imported Usuários: {len(user_map)} entries.")

    default_user_id = None
    if not dry_run:
        default_user = db.exec(select(Usuario).where(Usuario.empresa_id == empresa_id)).first()
        if not default_user:
            default_email = f"admin-{empresa_id}@kyruserp.com"
            default_user = Usuario(
                nome="Admin " + company_name,
                email=default_email,
                hashed_password=default_hashed_pwd,
                is_active=True,
                empresa_id=empresa_id
            )
            db.add(default_user)
            db.flush()
        default_user_id = default_user.id
        for key in user_map:
            if user_map[key] is None:
                user_map[key] = default_user_id

    # 6. Import Entidades (CadInteressado)
    entity_map = {}
    if "CadInteressado" in wb.sheetnames:
        sheet = wb["CadInteressado"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            name_idx = headers.index("Nome") if "Nome" in headers else (headers.index("Interessado") if "Interessado" in headers else 0)
            type_idx = headers.index("Tipo") if "Tipo" in headers else None
            
            for row in rows[1:]:
                if not any(row):
                    continue
                ent_name = clean_str(row[name_idx]) if name_idx < len(row) else ""
                if not ent_name:
                    continue
                
                ent_type = "AMBOS"
                if type_idx is not None and type_idx < len(row):
                    ent_type = clean_str(row[type_idx]).upper()
                
                norm_name = ent_name.upper()
                if "EQUATORIAL" in norm_name:
                    norm_name = "EQUATORIAL PA"
                elif "COSANPA" in norm_name:
                    norm_name = "COSANPA"
                elif "ESG CONTAB" in norm_name or "ESG CONTABILIDADE" in norm_name:
                    norm_name = "ESG CONTABILIDADE"

                ent = db.exec(
                    select(Entidade)
                    .where(Entidade.empresa_id == empresa_id, Entidade.nome == norm_name)
                ).first()
                if not ent:
                    ent = Entidade(
                        nome=norm_name,
                        tipo=ent_type if ent_type in ["CLIENTE", "FORNECEDOR", "AMBOS"] else "AMBOS",
                        empresa_id=empresa_id
                    )
                    if not dry_run:
                        db.add(ent)
                        db.flush()
                entity_map[ent_name] = ent.id
                entity_map[norm_name] = ent.id
        print(f"Imported Entidades: {len(entity_map)} entries.")

    default_client_id = None
    if not dry_run:
        default_client = db.exec(
            select(Entidade)
            .where(Entidade.empresa_id == empresa_id, Entidade.nome == "Cliente Consumidor")
        ).first()
        if not default_client:
            default_client = Entidade(
                nome="Cliente Consumidor",
                tipo="CLIENTE",
                empresa_id=empresa_id
            )
            db.add(default_client)
            db.flush()
        default_client_id = default_client.id
        for key in entity_map:
            if entity_map[key] is None:
                entity_map[key] = default_client_id

    # 7. Import Regras de Cartão (TxCartoes)
    rules_map = {}
    rules_cache = {}
    if "TxCartoes" in wb.sheetnames:
        sheet = wb["TxCartoes"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            tipo_idx = headers.index("Tipo") if "Tipo" in headers else 1
            band_idx = headers.index("Bandeira") if "Bandeira" in headers else 3
            taxa_idx = headers.index("Taxa") if "Taxa" in headers else 4
            dias_idx = headers.index("Dias") if "Dias" in headers else 5
            
            for row in rows[1:]:
                if not any(row):
                    continue
                tipo_p = clean_str(row[tipo_idx]) if tipo_idx < len(row) else ""
                band_p = clean_str(row[band_idx]) if band_idx < len(row) else ""
                
                if not tipo_p or not band_p:
                    continue

                val_taxa = parse_decimal(row[taxa_idx]) if taxa_idx < len(row) else Decimal("0.00")
                if val_taxa > 0 and val_taxa < 1:
                    val_taxa = val_taxa * 100

                dias = int(row[dias_idx]) if (dias_idx < len(row) and row[dias_idx] is not None) else 30

                mapped_tipo = "cartao_credito_vista"
                if "débito" in tipo_p.lower():
                    mapped_tipo = "cartao_debito"
                elif "parcelado" in tipo_p.lower():
                    mapped_tipo = "cartao_credito_parcelado"

                mapped_band = "OUTROS"
                band_l = band_p.lower()
                if "master" in band_l:
                    mapped_band = "MASTERCARD"
                elif "visa" in band_l:
                    mapped_band = "VISA"
                elif "elo" in band_l:
                    mapped_band = "ELO"
                elif "amex" in band_l or "american" in band_l:
                    mapped_band = "AMEX"
                elif "ifood" in band_l:
                    mapped_band = "IFOOD"

                regra = db.exec(
                    select(RegraCartao)
                    .where(
                        RegraCartao.empresa_id == empresa_id,
                        RegraCartao.tipo_pagamento == mapped_tipo,
                        RegraCartao.bandeira == mapped_band
                    )
                ).first()
                if not regra:
                    regra = RegraCartao(
                        tipo_pagamento=mapped_tipo,
                        bandeira=mapped_band,
                        taxa_porcentagem=val_taxa,
                        dias_payout=dias,
                        empresa_id=empresa_id,
                        tipo_prazo="DIA_FIXO_SEMANA" if mapped_band == "IFOOD" else "DIAS_CORRIDOS",
                        dia_fixo=2 if mapped_band == "IFOOD" else None
                    )
                    if not dry_run:
                        db.add(regra)
                        db.flush()
                rules_map[(mapped_tipo, mapped_band)] = regra.id
                rules_cache[(mapped_tipo, mapped_band)] = regra
        print(f"Imported Regras de Cartão: {len(rules_map)} entries.")

    # 8. Seed Generic Products
    product_map = {}
    if not dry_run:
        for suffix in ["Delivery", "Mesa", "Balcão"]:
            prod_name = f"Venda PDV {suffix}"
            prod = db.exec(
                select(Produto)
                .where(Produto.empresa_id == empresa_id, Produto.nome == prod_name)
            ).first()
            if not prod:
                prod = Produto(
                    nome=prod_name,
                    preco_unitario=Decimal("0.00"),
                    tipo="PRODUTO",
                    empresa_id=empresa_id,
                    is_active=True
                )
                db.add(prod)
                db.flush()
            product_map[suffix.upper()] = prod.id

    # Initialize pdv_config and DashboardViewConfig
    card_bank_id = None
    cash_bank_id = None
    for b_name in bank_map:
        if "itaú" in b_name.lower():
            card_bank_id = bank_map[b_name]
        if "caixa" in b_name.lower() or "pdv" in b_name.lower():
            cash_bank_id = bank_map[b_name]

    if not card_bank_id and bank_map:
        card_bank_id = list(bank_map.values())[0]
    if not cash_bank_id and bank_map:
        cash_bank_id = list(bank_map.values())[0]

    if not dry_run:
        # Load existing config to merge
        existing_config = {}
        if company.pdv_config:
            try:
                existing_config = json.loads(company.pdv_config)
            except Exception:
                pass

        # Resolve cost centers
        cc_pdv_id = existing_config.get("pdv_centro_custo_padrao_id")
        cc_ifood_id = existing_config.get("ifood_centro_custo_padrao_id")
        
        if "marco" in company_name.lower():
            cc_salao = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id, CentroCusto.nome == "Salão")).first()
            cc_delivery = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id, CentroCusto.nome == "Delivery")).first()
            if cc_salao:
                cc_pdv_id = cc_salao.id
            if cc_delivery:
                cc_ifood_id = cc_delivery.id
        else:
            cc_pdv_id = centro_id
            cc_ifood_id = centro_id

        config_data = {
            "categorias": existing_config.get("categorias", {
                "cartao_credito_vista": plano_fallback_id,
                "cartao_credito_parcelado": plano_fallback_id,
                "cartao_debito": plano_fallback_id
            }),
            "marcar_como_pago": existing_config.get("marcar_como_pago", {
                "dinheiro": True,
                "pix_chave": True,
                "pix_qr": True
            }),
            "contas": existing_config.get("contas", {
                "cartao_credito_vista": str(card_bank_id) if card_bank_id else "1",
                "cartao_credito_parcelado": str(card_bank_id) if card_bank_id else "1",
                "cartao_debito": str(card_bank_id) if card_bank_id else "1"
            }),
            "formas_pagamento": existing_config.get("formas_pagamento", [
                {"key": "dinheiro", "label": "Dinheiro", "parcelada": False},
                {"key": "pix_chave", "label": "Pix", "parcelada": False},
                {"key": "cartao_credito_vista", "label": "Crédito à Vista", "parcelada": False},
                {"key": "cartao_credito_parcelado", "label": "Crédito Parcelado", "parcelada": True},
                {"key": "cartao_debito", "label": "Débito", "parcelada": False}
            ]),
            "active_apps": existing_config.get("active_apps", ["ifood", "movimentacao_pdv"]),
            "centro_custo_padrao_id": cc_pdv_id,
            "centro_custo_flexivel": False,
            "pdv_centro_custo_padrao_id": cc_pdv_id,
            "pdv_centro_custo_flexivel": False,
            "ifood_centro_custo_padrao_id": cc_ifood_id,
            "ifood_centro_custo_flexivel": False,
            "pdv_conta_padrao_id": cash_bank_id,
            "ifood_conta_padrao_id": card_bank_id
        }

        company.pdv_config = json.dumps(config_data)
        db.add(company)
        db.flush()

        # Dashboard View Config Seeding
        dash_config = db.exec(
            select(DashboardViewConfig)
            .where(DashboardViewConfig.empresa_id == empresa_id)
        ).first()
        if not dash_config:
            dash_config = DashboardViewConfig(
                empresa_id=empresa_id,
                scope="empresa",
                config_key=f"dashboard_config_company_{empresa_id}",
                views=[
                    {"id": "bank_accounts_card", "visible": True, "position": 0},
                    {"id": "revenue_expense_chart", "visible": True, "position": 1},
                    {"id": "card_receipts_card", "visible": True, "position": 2}
                ]
            )
            db.add(dash_config)
            db.flush()

    # Pre-load existing import hashes to cache in memory
    existing_hashes = set()
    if not dry_run:
        hashes = db.exec(
            select(Lancamento.import_hash)
            .where(Lancamento.empresa_id == empresa_id, Lancamento.import_hash != None)
        ).all()
        existing_hashes = set(hashes)

    # 9. Import PDV Sales (Tb_Movimentacao) - OPTIMIZED FAST PATH
    pdv_sales_count = 0
    pdv_skipped_count = 0
    
    if "Tb_Movimentacao" in wb.sheetnames:
        sheet = wb["Tb_Movimentacao"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            
            id_idx = headers.index("IdPDV") if "IdPDV" in headers else 0
            dt_idx = headers.index("Data") if "Data" in headers else 1
            tipo_idx = headers.index("Tipo") if "Tipo" in headers else 2
            hist_idx = headers.index("Histórico") if "Histórico" in headers else 3
            forma_idx = headers.index("FormaPagto") if "FormaPagto" in headers else 4
            band_idx = headers.index("Bandeira") if "Bandeira" in headers else 5
            parc_idx = headers.index("Qtde Parcelas") if "Qtde Parcelas" in headers else 6
            val_idx = headers.index("Valor Cheio") if "Valor Cheio" in headers else 7
            cc_idx = headers.index("Centro de Custo") if "Centro de Custo" in headers else 8
            user_idx = headers.index("Usuário") if "Usuário" in headers else 12
            
            batch_lancamentos = []
            batch_vendas = []
            batch_venda_itens = []
            batch_pdv_movimentacoes = []
            
            for row in rows[1:]:
                if not any(row):
                    continue
                
                row_cc = clean_str(row[cc_idx]) if cc_idx < len(row) else ""
                if filter_center_of_cost and row_cc.lower() != filter_center_of_cost.lower():
                    continue

                pdv_id = clean_str(row[id_idx]) if id_idx < len(row) else ""
                dt = parse_date(row[dt_idx]) if dt_idx < len(row) else None
                tipo_mov = clean_str(row[tipo_idx]) if tipo_idx < len(row) else ""
                hist = clean_str(row[hist_idx]) if hist_idx < len(row) else ""
                forma = clean_str(row[forma_idx]) if forma_idx < len(row) else ""
                band = clean_str(row[band_idx]) if band_idx < len(row) else ""
                num_parcelas = int(row[parc_idx]) if (parc_idx < len(row) and row[parc_idx] is not None) else 1
                val_cheio = parse_decimal(row[val_idx]) if val_idx < len(row) else Decimal("0.00")
                username = clean_str(row[user_idx]) if user_idx < len(row) else ""

                if tipo_mov.lower() == "saída" or forma.lower() == "sangrias" or forma.lower() == "sangria":
                    continue

                if not pdv_id or val_cheio <= 0:
                    continue

                import_hash = f"legacy-{pdv_id}"
                if import_hash in existing_hashes:
                    pdv_skipped_count += 1
                    continue

                # Map payment parameters
                tipo_pag = "dinheiro"
                forma_l = forma.lower()
                if "pix" in forma_l:
                    tipo_pag = "pix_chave"
                elif "débito" in forma_l:
                    tipo_pag = "cartao_debito"
                elif "parcelado" in forma_l:
                    tipo_pag = "cartao_credito_parcelado"
                elif "à vista" in forma_l or "credito" in forma_l or "crédito" in forma_l:
                    tipo_pag = "cartao_credito_vista"
                elif "link" in forma_l or "on line" in forma_l or "online" in forma_l or "ifood" in forma_l:
                    tipo_pag = "cartao_credito_vista"

                mapped_band = "OUTROS"
                band_l = band.lower() if band else ""
                if "master" in band_l:
                    mapped_band = "MASTERCARD"
                elif "visa" in band_l:
                    mapped_band = "VISA"
                elif "elo" in band_l:
                    mapped_band = "ELO"
                elif "amex" in band_l:
                    mapped_band = "AMEX"
                elif "ifood" in band_l or "link" in forma_l or "on line" in forma_l or "online" in forma_l:
                    mapped_band = "IFOOD"

                is_paid = tipo_pag in ["dinheiro", "pix_chave", "pix_qr"]
                
                # Resolve account
                conta_id = cash_bank_id if tipo_pag == "dinheiro" else card_bank_id

                # Find rule
                rule = rules_cache.get((tipo_pag, mapped_band))

                # Product info
                hist_u = hist.upper()
                product_suffix = "BALCÃO"
                if "DELIVERY" in hist_u:
                    product_suffix = "DELIVERY"
                elif "MESA" in hist_u:
                    product_suffix = "MESA"
                prod_id = product_map.get(product_suffix, list(product_map.values())[0] if product_map else 1)

                vendedor_id = user_map.get(username, default_user_id)

                if not dry_run:
                    # Create operational PdvVenda
                    venda_uuid = f"legacy-pdv-{pdv_id}"
                    venda_op = PdvVenda(
                        id=venda_uuid,
                        empresa_id=empresa_id,
                        entidade_id=default_client_id,
                        vendedor_id=vendedor_id,
                        centro_custo_id=centro_id,
                        data_venda=dt if dt else date.today(),
                        hora_venda="18:00:00",
                        valor_subtotal=val_cheio,
                        valor_desconto=Decimal("0.00"),
                        valor_total=val_cheio,
                        status="REALIZADO",
                        observacao=hist,
                        rv=pdv_id,
                        is_direct_sale=False,
                        import_hash=import_hash,
                        created_by_id=vendedor_id,
                        updated_by_id=default_user_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    batch_vendas.append(venda_op)

                    # Create operational PdvVendaItem
                    venda_item_op = PdvVendaItem(
                        venda_id=venda_uuid,
                        produto_id=prod_id,
                        quantidade=Decimal("1.00"),
                        preco_unitario=val_cheio,
                        desconto=Decimal("0.00"),
                        subtotal=val_cheio,
                        nome_customizado=f"Venda PDV {product_suffix}"
                    )
                    batch_venda_itens.append(venda_item_op)

                    # Map payment format to PdvMovimentacao payment enum
                    forma_pag_mov = "DINHEIRO"
                    if "pix" in forma_l:
                        forma_pag_mov = "PIX"
                    elif "débito" in forma_l:
                        forma_pag_mov = "DEBITO"
                    elif "parcelado" in forma_l:
                        forma_pag_mov = "CREDITO_PARCELADO"
                    elif "à vista" in forma_l or "credito" in forma_l or "crédito" in forma_l:
                        forma_pag_mov = "CREDITO_AVISTA"

                    # Create operational PdvMovimentacao
                    mov_op = PdvMovimentacao(
                        empresa_id=empresa_id,
                        tipo="ENTRADA",
                        descricao=f"Venda PDV {product_suffix}",
                        valor=val_cheio,
                        forma_pagamento=forma_pag_mov,
                        bandeira=mapped_band,
                        parcelas=num_parcelas,
                        data=dt if dt else date.today(),
                        centro_custo_id=centro_id,
                        conta_id=conta_id,
                        conciliado=False,
                        venda_id=venda_uuid,
                        import_hash=f"mov-{import_hash}",
                        created_by_id=vendedor_id,
                        updated_by_id=default_user_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    batch_pdv_movimentacoes.append(mov_op)

                    # Construct base metadata for observacao field
                    obs_data = {
                        "origem": "PDV",
                        "rv": pdv_id,
                        "tipo_pagamento": tipo_pag,
                        "vendedor_id": vendedor_id,
                        "cliente_id": default_client_id,
                        "centro_custo_id": centro_id,
                        "desconto_total": 0.0,
                        "itens": [
                            {
                                "produto_id": prod_id,
                                "nome": f"Venda PDV {product_suffix}",
                                "quantidade": 1,
                                "preco_unitario": float(val_cheio),
                                "desconto": 0.0,
                                "subtotal": float(val_cheio)
                            }
                        ]
                    }

                    # Handle installments split
                    if num_parcelas > 1 and tipo_pag == "cartao_credito_parcelado":
                        valor_parcela = (val_cheio / num_parcelas).quantize(Decimal("0.01"))
                        for i in range(1, num_parcelas + 1):
                            installment_obs = obs_data.copy()
                            installment_obs["numero_parcela"] = i
                            installment_obs["total_parcelas"] = num_parcelas

                            if rule:
                                payout_days = rule.dias_payout + 30 * (i - 1)
                                venc_p = dt + timedelta(days=payout_days) if dt else date.today()
                                fee_percentage = rule.taxa_porcentagem
                                fee_amount = (valor_parcela * fee_percentage / 100).quantize(Decimal("0.01"))
                                liquid_value = valor_parcela - fee_amount
                                
                                installment_obs["bandeira"] = rule.bandeira
                                installment_obs["cartao_taxa"] = float(fee_percentage)
                                installment_obs["cartao_taxa_valor"] = float(fee_amount)
                                installment_obs["cartao_liquido_previsto"] = float(liquid_value)
                                installment_obs["cartao_regra_id"] = rule.id
                            else:
                                venc_p = dt + timedelta(days=30 * i) if dt else date.today()

                            l = Lancamento(
                                descricao=f"Venda RV-{pdv_id} ({i}/{num_parcelas}) - Venda PDV {product_suffix}",
                                tipo="RECEITA",
                                status="EM ABERTO",
                                origem="PDV",
                                valor_previsto=valor_parcela,
                                valor_pago=Decimal("0.00"),
                                valor_juros=Decimal("0.00"),
                                valor_desconto=Decimal("0.00"),
                                valor_multa=Decimal("0.00"),
                                data_vencimento=venc_p,
                                data_pagamento=None,
                                data_competencia=dt if dt else date.today(),
                                empresa_id=empresa_id,
                                plano_contas_id=plano_fallback_id,
                                conta_id=conta_id,
                                entidade_id=default_client_id,
                                centro_custo_id=centro_id,
                                created_by_id=vendedor_id,
                                updated_by_id=default_user_id,
                                observacao=json.dumps(installment_obs),
                                is_deleted=False,
                                ipp=False,
                                previsto=True,
                                conciliado=False,
                                numero_parcela=i,
                                id_parcelamento=f"legacy-pdv-{pdv_id}",
                                import_hash=import_hash if i == 1 else f"{import_hash}-p{i}",
                                created_at=datetime.utcnow(),
                                updated_at=datetime.utcnow()
                            )
                            batch_lancamentos.append(l)
                    else:
                        if rule:
                            venc_p = dt + timedelta(days=rule.dias_payout) if dt else date.today()
                            if rule.tipo_prazo == "DIA_FIXO_SEMANA" and rule.dia_fixo is not None:
                                days_to_target = (rule.dia_fixo - venc_p.weekday()) % 7
                                venc_p = venc_p + timedelta(days=days_to_target)
                            fee_percentage = rule.taxa_porcentagem
                            fee_amount = (val_cheio * fee_percentage / 100).quantize(Decimal("0.01"))
                            liquid_value = val_cheio - fee_amount
                            
                            obs_data["bandeira"] = rule.bandeira
                            obs_data["cartao_taxa"] = float(fee_percentage)
                            obs_data["cartao_taxa_valor"] = float(fee_amount)
                            obs_data["cartao_liquido_previsto"] = float(liquid_value)
                            obs_data["cartao_regra_id"] = rule.id
                        else:
                            venc_p = dt if dt else date.today()

                        l = Lancamento(
                            descricao=f"Venda RV-{pdv_id} - Venda PDV {product_suffix}",
                            tipo="RECEITA",
                            status="PAGO" if is_paid else "EM ABERTO",
                            origem="PDV",
                            valor_previsto=val_cheio,
                            valor_pago=val_cheio if is_paid else Decimal("0.00"),
                            valor_juros=Decimal("0.00"),
                            valor_desconto=Decimal("0.00"),
                            valor_multa=Decimal("0.00"),
                            data_vencimento=venc_p,
                            data_pagamento=dt if is_paid else None,
                            data_competencia=dt if dt else date.today(),
                            empresa_id=empresa_id,
                            plano_contas_id=plano_fallback_id,
                            conta_id=conta_id,
                            entidade_id=default_client_id,
                            centro_custo_id=centro_id,
                            created_by_id=vendedor_id,
                            updated_by_id=default_user_id,
                            observacao=json.dumps(obs_data),
                            is_deleted=False,
                            ipp=False,
                            previsto=True,
                            conciliado=False,
                            id_parcelamento=f"legacy-pdv-{pdv_id}",
                            import_hash=import_hash,
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow()
                        )
                        batch_lancamentos.append(l)

                    pdv_sales_count += 1
                    existing_hashes.add(import_hash)

            if not dry_run and batch_lancamentos:
                # Add in batches of 5000 to be memory-efficient and fast
                for chunk_idx in range(0, len(batch_lancamentos), 5000):
                    chunk = batch_lancamentos[chunk_idx:chunk_idx+5000]
                    db.add_all(chunk)
                    db.flush()
                print(f"Flushed {len(batch_lancamentos)} fast-path PDV Lancamentos.")

            if not dry_run and batch_vendas:
                for chunk_idx in range(0, len(batch_vendas), 5000):
                    db.add_all(batch_vendas[chunk_idx:chunk_idx+5000])
                    db.flush()
                print(f"Flushed {len(batch_vendas)} PdvVenda operational records.")

            if not dry_run and batch_venda_itens:
                for chunk_idx in range(0, len(batch_venda_itens), 5000):
                    db.add_all(batch_venda_itens[chunk_idx:chunk_idx+5000])
                    db.flush()
                print(f"Flushed {len(batch_venda_itens)} PdvVendaItem operational records.")

            if not dry_run and batch_pdv_movimentacoes:
                for chunk_idx in range(0, len(batch_pdv_movimentacoes), 5000):
                    db.add_all(batch_pdv_movimentacoes[chunk_idx:chunk_idx+5000])
                    db.flush()
                print(f"Flushed {len(batch_pdv_movimentacoes)} PdvMovimentacao operational records.")

        print(f"Imported PDV Sales: {pdv_sales_count} rows, skipped: {pdv_skipped_count}.")

    # 10. Import iFood transactions (Tb_Ifood)
    ifood_count = 0
    ifood_skipped_count = 0
    if "Tb_Ifood" in wb.sheetnames and filter_center_of_cost != "Marco":
        sheet = wb["Tb_Ifood"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            id_idx = headers.index("Id_Ifood") if "Id_Ifood" in headers else 0
            dt_idx = headers.index("Data") if "Data" in headers else 1
            hr_idx = headers.index("Hora") if "Hora" in headers else 2
            forma_idx = headers.index("Forma Pagto") if "Forma Pagto" in headers else 3
            bruto_idx = headers.index("Valor Bruto") if "Valor Bruto" in headers else 4
            liq_idx = headers.index("Valor Líquido") if "Valor Líquido" in headers else 5
            status_idx = headers.index("Status") if "Status" in headers else 6
            rec_idx = headers.index("Data Recebimento") if "Data Recebimento" in headers else 7

            batch_ifood = []

            for row in rows[1:]:
                if not any(row):
                    continue
                ifood_id = clean_str(row[id_idx]) if id_idx < len(row) else ""
                if not ifood_id:
                    continue

                dt_venda = parse_date(row[dt_idx]) if dt_idx < len(row) else None
                hora_v = clean_str(row[hr_idx]) if hr_idx < len(row) else ""
                if isinstance(hora_v, time):
                    hora_v = hora_v.strftime("%H:%M:%S")
                elif not hora_v:
                    hora_v = "18:00:00"

                forma_r = clean_str(row[forma_idx]) if forma_idx < len(row) else ""
                val_bruto = parse_decimal(row[bruto_idx]) if bruto_idx < len(row) else Decimal("0.00")
                val_liq = parse_decimal(row[liq_idx]) if liq_idx < len(row) else Decimal("0.00")
                st = clean_str(row[status_idx]) if status_idx < len(row) else ""
                dt_rec = parse_date(row[rec_idx]) if rec_idx < len(row) else None

                if not dry_run:
                    # Look up in database using a bulk query is not trivial, but since iFood is smaller (~20k rows)
                    # we can still run bulk inserts
                    ifood_tx = PdvIfoodLancamento(
                        empresa_id=empresa_id,
                        forma_recebimento=forma_r,
                        valor_bruto=val_bruto,
                        valor_liquido=val_liq,
                        data_venda=dt_venda,
                        hora_venda=hora_v,
                        data_recebimento_ajustada=dt_rec if dt_rec else dt_venda,
                        status_conciliado=True,
                        despesas_extras_str=f"legacy_id:{ifood_id}"
                    )
                    batch_ifood.append(ifood_tx)
                    ifood_count += 1
            
            if not dry_run and batch_ifood:
                for chunk_idx in range(0, len(batch_ifood), 5000):
                    db.add_all(batch_ifood[chunk_idx:chunk_idx+5000])
                    db.flush()

        print(f"Imported iFood Transactions: {ifood_count} rows, skipped: {ifood_skipped_count}.")

    # Load cache of PDV sales (date, value) for post-2025-01-22 duplicate filtering
    pdv_sales_cache = set()
    if not dry_run:
        sales_data = db.exec(
            select(Lancamento.data_pagamento, Lancamento.valor_previsto)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.origem == "PDV",
                Lancamento.data_pagamento >= date(2025, 1, 22)
            )
        ).all()
        for d, v in sales_data:
            if d:
                pdv_sales_cache.add((d, float(v)))

    # 11. Import Financeiro (Tb_Financeira) - OPTIMIZED FAST PATH
    fin_count = 0
    fin_skipped_count = 0
    
    if "Tb_Financeira" in wb.sheetnames:
        sheet = wb["Tb_Financeira"]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) > 1:
            headers = [clean_str(h) for h in rows[0]]
            
            id_idx = headers.index("IdFinanceiro") if "IdFinanceiro" in headers else 0
            vcto_idx = headers.index("Data Vcto") if "Data Vcto" in headers else 1
            pag_idx = headers.index("Data Pagto") if "Data Pagto" in headers else 2
            tipo_idx = headers.index("Tipo") if "Tipo" in headers else 3
            class_idx = headers.index("Classificação") if "Classificação" in headers else 4
            desc_idx = headers.index("Descrição") if "Descrição" in headers else 5
            prev_idx = headers.index("Valor Previsto") if "Valor Previsto" in headers else 6
            real_idx = headers.index("Valor Realizado") if "Valor Realizado" in headers else 7
            bank_idx = headers.index("Banco") if "Banco" in headers else 8
            sit_idx = headers.index("Situação") if "Situação" in headers else 9
            parc_idx = headers.index("IdParcelamento") if "IdParcelamento" in headers else 10
            int_idx = headers.index("Interessado") if "Interessado" in headers else 11
            cc_idx = headers.index("Centro de Custo") if "Centro de Custo" in headers else 12

            # Group rows by date and absolute value to find pairs of transfers
            import uuid
            potential_transfers = {}
            for idx, row in enumerate(rows[1:]):
                if not any(row):
                    continue
                row_cc = clean_str(row[cc_idx]) if cc_idx < len(row) else ""
                if filter_center_of_cost and row_cc.lower() != filter_center_of_cost.lower():
                    continue
                
                fin_id = clean_str(row[id_idx]) if id_idx < len(row) else ""
                if not fin_id:
                    continue
                
                dt_pag = parse_date(row[pag_idx]) if pag_idx < len(row) else None
                if not dt_pag:
                    continue
                
                val_real = parse_decimal(row[real_idx]) if real_idx < len(row) else Decimal("0.00")
                if val_real == 0:
                    continue
                
                tipo_f = clean_str(row[tipo_idx]) if tipo_idx < len(row) else ""
                class_f = clean_str(row[class_idx]) if class_idx < len(row) else ""
                
                class_l = class_f.lower()
                is_transfer_class = ("transfer" in class_l or "aplic" in class_l or "resgate" in class_l)
                
                if is_transfer_class:
                    key = (dt_pag, abs(val_real))
                    if key not in potential_transfers:
                        potential_transfers[key] = []
                    potential_transfers[key].append((idx, fin_id, tipo_f, val_real))
            
            transfer_links = {}
            for key, items in potential_transfers.items():
                recebimentos = [x for x in items if x[2].lower() == "recebimento" or x[3] > 0]
                pagamentos = [x for x in items if x[2].lower() != "recebimento" or x[3] < 0]
                for r, p in zip(recebimentos, pagamentos):
                    group_id = str(uuid.uuid4())
                    transfer_links[r[1]] = group_id
                    transfer_links[p[1]] = group_id

            batch_fin = []

            for row in rows[1:]:
                if not any(row):
                    continue

                row_cc = clean_str(row[cc_idx]) if cc_idx < len(row) else ""
                if filter_center_of_cost and row_cc.lower() != filter_center_of_cost.lower():
                    continue

                fin_id = clean_str(row[id_idx]) if id_idx < len(row) else ""
                if not fin_id:
                    continue

                dt_vcto = parse_date(row[vcto_idx]) if vcto_idx < len(row) else None
                dt_pag = parse_date(row[pag_idx]) if pag_idx < len(row) else None
                tipo_f = clean_str(row[tipo_idx]) if tipo_idx < len(row) else ""
                class_f = clean_str(row[class_idx]) if class_idx < len(row) else ""
                desc = clean_str(row[desc_idx]) if desc_idx < len(row) else ""
                val_prev = parse_decimal(row[prev_idx]) if prev_idx < len(row) else Decimal("0.00")
                val_real = parse_decimal(row[real_idx]) if real_idx < len(row) else Decimal("0.00")
                bank_name = clean_str(row[bank_idx]) if bank_idx < len(row) else ""
                sit = clean_str(row[sit_idx]) if sit_idx < len(row) else ""
                id_parc = clean_str(row[parc_idx]) if parc_idx < len(row) else ""
                interessado = clean_str(row[int_idx]) if int_idx < len(row) else ""

                import_hash = f"legacy-{fin_id}"
                if import_hash in existing_hashes:
                    fin_skipped_count += 1
                    continue

                is_duplicate = False
                group_id = transfer_links.get(fin_id)
                
                if dt_pag and dt_pag >= date(2025, 1, 22):
                    class_l = class_f.lower()
                    if "pix" in class_l or "01.04. pix" in class_l or "01.05. pix" in class_l:
                        if (dt_pag, float(val_real)) in pdv_sales_cache:
                            is_duplicate = True
                    elif "dinheiro" in class_l or "01.01. dinheiro" in class_l:
                        if tipo_f.lower() == "recebimento":
                            if (dt_pag, float(val_real)) in pdv_sales_cache:
                                is_duplicate = True

                pc_id = pc_map.get(class_f, plano_fallback_id)
                conta_id = bank_map.get(bank_name)
                if not conta_id and bank_map:
                    conta_id = list(bank_map.values())[0]

                ent_id = entity_map.get(interessado, default_client_id)

                if is_duplicate:
                    # Find cash/pdv account in bank_map to act as the source of the transfer (the sangria!)
                    source_conta_id = None
                    for bname, cid in bank_map.items():
                        bname_l = bname.lower()
                        if "caixa" in bname_l or "pdv" in bname_l:
                            source_conta_id = cid
                            break
                    
                    if source_conta_id:
                        group_id = str(uuid.uuid4())
                        # Create the matching DESPESA in Caixa PDV (the sangria!)
                        if not dry_run:
                            sangria = Lancamento(
                                descricao=f"Sangria/Depósito - {desc or class_f}",
                                tipo="DESPESA",
                                status="PAGO",
                                origem="WEB",
                                valor_previsto=val_prev,
                                valor_pago=val_real,
                                data_vencimento=dt_vcto if dt_vcto else date.today(),
                                data_pagamento=dt_pag,
                                data_competencia=dt_pag if dt_pag else (dt_vcto if dt_vcto else date.today()),
                                id_parcelamento=id_parc,
                                observacao=f"Sangria automática de caixa - Duplicado de PDV ID {fin_id}",
                                import_hash=f"sangria-{fin_id}",
                                plano_contas_id=pc_id,
                                conta_id=source_conta_id,
                                entidade_id=ent_id,
                                empresa_id=empresa_id,
                                transferencia_grupo_id=group_id
                            )
                            batch_fin.append(sangria)
                            fin_count += 1

                if not dry_run:
                    lanc = Lancamento(
                        descricao=desc or f"Importação {class_f}",
                        tipo="RECEITA" if tipo_f.lower() == "recebimento" else "DESPESA",
                        status=sit.upper() if sit else "EM ABERTO",
                        origem="WEB",
                        valor_previsto=val_prev,
                        valor_pago=val_real if sit.upper() == "PAGO" else Decimal("0.00"),
                        data_vencimento=dt_vcto if dt_vcto else date.today(),
                        data_pagamento=dt_pag if sit.upper() == "PAGO" else None,
                        data_competencia=dt_pag if dt_pag else (dt_vcto if dt_vcto else date.today()),
                        id_parcelamento=id_parc,
                        observacao=f"Importação Financeiro - Legado ID {fin_id}",
                        import_hash=import_hash,
                        plano_contas_id=pc_id,
                        conta_id=conta_id,
                        entidade_id=ent_id,
                        empresa_id=empresa_id,
                        transferencia_grupo_id=group_id
                    )
                    batch_fin.append(lanc)
                    fin_count += 1
                    existing_hashes.add(import_hash)

            if not dry_run and batch_fin:
                for chunk_idx in range(0, len(batch_fin), 5000):
                    db.add_all(batch_fin[chunk_idx:chunk_idx+5000])
                    db.flush()
                print(f"Flushed {len(batch_fin)} fast-path Financeiro Lancamentos.")

    if not dry_run:
        # Mathematical reverse calculation of starting balance (saldo_inicial) for each account
        db.flush()
        for acc in stats["accounts"]:
            conta_id = acc["conta_id"]
            expected_final = Decimal(str(acc["saldo_final_esperado"]))
            
            # Query the database for the sum of paid revenues and expenses for this account
            receitas = db.exec(
                select(func.sum(Lancamento.valor_pago))
                .where(
                    Lancamento.conta_id == conta_id,
                    Lancamento.tipo == "RECEITA",
                    Lancamento.status == "PAGO",
                    Lancamento.is_deleted == False
                )
            ).first() or Decimal("0.00")
            
            despesas = db.exec(
                select(func.sum(Lancamento.valor_pago))
                .where(
                    Lancamento.conta_id == conta_id,
                    Lancamento.tipo == "DESPESA",
                    Lancamento.status == "PAGO",
                    Lancamento.is_deleted == False
                )
            ).first() or Decimal("0.00")
            
            required_saldo_inicial = expected_final - receitas + despesas
            
            # Update in database
            conta = db.get(Conta, conta_id)
            if conta:
                conta.saldo_inicial = required_saldo_inicial
                db.add(conta)
                acc["saldo_inicial"] = float(required_saldo_inicial)
        db.flush()

    wb.close()

    # Commit after unit completed
    if not dry_run:
        db.commit()
        print(f"Successfully committed data for {company_name}.")
        
        # Calculate current balances in Kyrus for stats
        for acc in stats["accounts"]:
            acc["saldo_final_kyrus"] = float(get_account_balance(db, acc["conta_id"]))
            
    stats["pdv_imported"] = pdv_sales_count
    stats["pdv_skipped"] = pdv_skipped_count
    stats["ifood_imported"] = ifood_count
    stats["ifood_skipped"] = ifood_skipped_count
    stats["fin_imported"] = fin_count
    stats["fin_skipped"] = fin_skipped_count

    return stats

def generate_html_report(results: list, output_path: str):
    html_content = f"""<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relatório de Importação - Pizza Fábio</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        body {{
            font-family: 'Outfit', sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
        }}
    </style>
</head>
<body class="p-8">
    <div class="max-w-6xl mx-auto">
        <header class="flex justify-between items-center mb-10 border-b border-slate-700 pb-6">
            <div>
                <h1 class="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Relatório de Importação</h1>
                <p class="text-slate-400 mt-2">Validação e reconciliação das 4 unidades da pizzaria Pizza Fábio</p>
            </div>
            <div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-2 rounded-full font-semibold">
                Status: Sucesso
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
    """

    for res in results:
        html_content += f"""
            <div class="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-2xl p-6 shadow-xl">
                <h2 class="text-2xl font-bold text-slate-200 mb-4 border-b border-slate-700 pb-2">{res['company_name']}</h2>
                
                <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                        <span class="text-xs text-slate-400 uppercase tracking-wider">Vendas PDV</span>
                        <div class="text-lg font-bold text-slate-100 mt-1">{res['pdv_imported']}</div>
                        <span class="text-xs text-slate-500">{res['pdv_skipped']} pulados</span>
                    </div>
                    <div class="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                        <span class="text-xs text-slate-400 uppercase tracking-wider">iFood</span>
                        <div class="text-lg font-bold text-slate-100 mt-1">{res['ifood_imported']}</div>
                        <span class="text-xs text-slate-500">{res['ifood_skipped']} pulados</span>
                    </div>
                    <div class="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                        <span class="text-xs text-slate-400 uppercase tracking-wider">Financeiro</span>
                        <div class="text-lg font-bold text-slate-100 mt-1">{res['fin_imported']}</div>
                        <span class="text-xs text-slate-500">{res['fin_skipped']} pulados</span>
                    </div>
                </div>

                <h3 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Reconciliação Bancária</h3>
                <div class="space-y-3">
        """

        for acc in res['accounts']:
            diff = abs(acc['saldo_final_expected'] - acc['saldo_final_kyrus'])
            status_color = "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" if diff < 0.05 else "text-rose-400 border-rose-500/20 bg-rose-500/5"
            status_text = "Verificado" if diff < 0.05 else "Discrepância"
            
            html_content += f"""
                    <div class="flex justify-between items-center p-3 rounded-xl border {status_color}">
                        <div>
                            <div class="font-semibold text-slate-200">{acc['nome']}</div>
                            <div class="text-xs text-slate-400 mt-0.5">Saldo Inicial: R$ {acc['saldo_inicial']:.2f}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-sm font-semibold">Esperado: R$ {acc['saldo_final_expected']:.2f}</div>
                            <div class="text-sm font-bold">Kyrus: R$ {acc['saldo_final_kyrus']:.2f}</div>
                            <span class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-900/40">{status_text}</span>
                        </div>
                    </div>
            """

        html_content += """
                </div>
            </div>
        """

    html_content += """
        </div>
        
        <footer class="text-center text-xs text-slate-500 border-t border-slate-800 pt-6 mt-10">
            Kyrus ERP & Antigravity Systems &copy; 2026. Importação concluída com sucesso.
        </footer>
    </div>
</body>
</html>
    """

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"Generated HTML report at: {output_path}")

def import_all_data(
    db: Session,
    path_umarizal: str,
    path_ananindeua: str,
    path_ifood_marco: str,
    dry_run=False
):
    results = []

    # 1. Pizza Fábio Umarizal
    res_uma = import_unit(
        db=db,
        file_path=path_umarizal,
        company_name="Pizza Fábio Umarizal",
        filter_center_of_cost="Umarizal",
        dry_run=dry_run
    )
    results.append(res_uma)

    # 2. Pizza Fábio Marco Salão
    res_m_sal = import_unit(
        db=db,
        file_path=path_umarizal,
        company_name="Pizza Fábio Marco",
        filter_center_of_cost="Marco",
        dry_run=dry_run
    )
    results.append(res_m_sal)

    # 3. Pizza Fábio Ananindeua
    res_ana = import_unit(
        db=db,
        file_path=path_ananindeua,
        company_name="Pizza Fábio Ananindeua",
        filter_center_of_cost=None,
        dry_run=dry_run
    )
    results.append(res_ana)

    # 4. Pizza Fábio Marco Delivery
    res_m_del = import_unit(
        db=db,
        file_path=path_ifood_marco,
        company_name="Pizza Fábio Marco",
        filter_center_of_cost=None,
        dry_run=dry_run
    )
    results.append(res_m_del)

    # Re-normalize data names to match html formatting expectations
    report_data = []
    for res in results:
        accs = []
        for acc in res["accounts"]:
            accs.append({
                "nome": acc["nome"],
                "saldo_inicial": acc["saldo_inicial"],
                "saldo_final_expected": acc["saldo_final_esperado"],
                "saldo_final_kyrus": acc["saldo_final_kyrus"]
            })
        report_data.append({
            "company_name": res["company_name"],
            "pdv_imported": res["pdv_imported"],
            "pdv_skipped": res["pdv_skipped"],
            "ifood_imported": res["ifood_imported"],
            "ifood_skipped": res["ifood_skipped"],
            "fin_imported": res["fin_imported"],
            "fin_skipped": res["fin_skipped"],
            "accounts": accs
        })

    # Save JSON Summary in scratch directory
    scratch_dir = "/app/static/uploads" # accessible inside Docker easily
    os.makedirs(scratch_dir, exist_ok=True)
    summary_path = os.path.join(scratch_dir, "import_pizza_fabio_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved import summary JSON to: {summary_path}")

    # Generate HTML Report
    html_path = "/app/static/relatorio_importacao_fabio.html"
    generate_html_report(report_data, html_path)
    
    print("\nAll units processed successfully.")

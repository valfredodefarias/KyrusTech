# scripts/migrate_rosario_sales.py
import os
import sys
import json
import re
import argparse
import unicodedata
import pandas as pd
from datetime import datetime, date
from decimal import Decimal
from collections import defaultdict

# Add app directory to PYTHONPATH
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.centro_custo import CentroCusto
from app.models.lancamento import Lancamento
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.services.pdv_service import PdvService

# Constants
EMPRESA_ID = 27  # Rosario Belem
CENTRO_CUSTO_ID = 53  # BELÉM
DEFAULT_PLAN_ID = 3011  # "Dinheiro" (01.01.01)

def parse_date(date_str, mes_str="") -> date:
    """Parses date from Excel column or uses fallback."""
    if pd.isna(date_str):
        return datetime.utcnow().date()
    if isinstance(date_str, (datetime, date)):
        if isinstance(date_str, datetime):
            return date_str.date()
        return date_str
    
    date_str = str(date_str).strip()
    if date_str and "/" in date_str and len(date_str.split("/")) == 2:
        year = None
        if mes_str and "/" in str(mes_str):
            parts = str(mes_str).split("/")
            try:
                year = int(parts[-1].strip())
            except ValueError:
                pass
        if year is not None:
            if year < 100:
                year = 2000 + year
            date_str = f"{date_str}/{year}"
        else:
            date_str = f"{date_str}/26"

    for fmt in ("%d/%m/%y", "%d/%m/%Y", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            if "/" in date_str:
                parts = date_str.split("/")
                if len(parts) == 3:
                    day = int(parts[0])
                    month = int(parts[1])
                    year_str = parts[2].split()[0]
                    if len(year_str) == 2:
                        year = int(f"20{year_str}")
                    else:
                        year = int(year_str)
                    return date(year, month, day)
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return datetime.utcnow().date()

def parse_decimal(val) -> Decimal:
    """Parses float/decimal from Excel."""
    if pd.isna(val):
        return Decimal("0.00")
    if isinstance(val, (int, float, Decimal)):
        return Decimal(str(val))
    val_str = str(val).strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(val_str)
    except Exception:
        return Decimal("0.00")

def mapear_forma_pagamento(forma_csv: str) -> str:
    """Maps spreadsheet payment methods to internal Kyrus ERP types."""
    forma_csv = str(forma_csv).strip().lower() if not pd.isna(forma_csv) else ""
    if "pix" in forma_csv:
        return "pix_chave"
    elif "dinheiro" in forma_csv:
        return "dinheiro"
    elif "débito" in forma_csv or "debito" in forma_csv:
        return "cartao_debito"
    elif "parcelado" in forma_csv and "crédito" in forma_csv:
        return "cartao_credito_parcelado"
    elif "crédito à vista" in forma_csv or "credito" in forma_csv:
        return "cartao_credito_vista"
    elif "boleto" in forma_csv:
        return "boleto"
    elif "site" in forma_csv:
        return "pix_chave"
    else:
        return "dinheiro"

def clean_email(nome_vendedor: str) -> str:
    n = unicodedata.normalize("NFKD", nome_vendedor.lower())
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r'[^a-z0-9\s_]', '', n)
    n = re.sub(r'\s+', '_', n)
    return f"{n}@kyrus_legado.com"

def obter_ou_criar_vendedor(db: Session, nome_vendedor: str, vendedor_cache: dict) -> Usuario:
    nome_vendedor = str(nome_vendedor).strip() if not pd.isna(nome_vendedor) else ""
    if not nome_vendedor:
        nome_vendedor = "Vendedor Legado"
        
    nome_lower = nome_vendedor.lower()
    if nome_lower in vendedor_cache:
        return vendedor_cache[nome_lower]
        
    user = db.exec(
        select(Usuario)
        .where(
            Usuario.empresa_id == EMPRESA_ID,
            col(Usuario.nome).ilike(nome_vendedor)
        )
    ).first()
    
    if not user:
        email = clean_email(nome_vendedor)
        user = Usuario(
            nome=nome_vendedor,
            email=email,
            hashed_password="fake_hashed_password",
            is_active=True,
            is_deleted=False,
            empresa_id=EMPRESA_ID
        )
        db.add(user)
        db.flush()
        print(f"  Vendedor criado: {nome_vendedor} (Email: {email})")
        
    vendedor_cache[nome_lower] = user
    return user

def obter_ou_criar_cliente(db: Session, nome_cliente: str, cliente_cache: dict) -> Entidade:
    nome_cliente = str(nome_cliente).strip() if not pd.isna(nome_cliente) else ""
    if not nome_cliente:
        nome_cliente = "Cliente Legado Balcão"
        
    nome_lower = nome_cliente.lower()
    if nome_lower in cliente_cache:
        return cliente_cache[nome_lower]
        
    cliente = db.exec(
        select(Entidade)
        .where(
            Entidade.empresa_id == EMPRESA_ID,
            col(Entidade.nome).ilike(nome_cliente)
        )
    ).first()
    
    if not cliente:
        cliente = Entidade(
            nome=nome_cliente,
            tipo="CLIENTE",
            empresa_id=EMPRESA_ID,
            is_deleted=False
        )
        db.add(cliente)
        db.flush()
        print(f"  Cliente criado: {nome_cliente}")
        
    cliente_cache[nome_lower] = cliente
    return cliente

def obter_ou_criar_produto(db: Session, familia: str, sub_familia: str, produto_cache: dict) -> Produto:
    familia = str(familia).strip() if not pd.isna(familia) else "Audio"
    sub_familia = str(sub_familia).strip() if not pd.isna(sub_familia) else "Acessórios"
    
    nome_produto = f"{familia} - {sub_familia}"
    nome_lower = nome_produto.lower()
    
    if nome_lower in produto_cache:
        return produto_cache[nome_lower]
    
    prod = db.exec(
        select(Produto)
        .where(
            Produto.empresa_id == EMPRESA_ID,
            col(Produto.nome).ilike(nome_produto),
            Produto.is_deleted == False
        )
    ).first()
    
    if not prod:
        tipo = "SERVICO" if familia.lower() in ("serviços", "servicos") else "PRODUTO"
        prod = Produto(
            nome=nome_produto,
            preco_unitario=Decimal("0.00"),
            tipo=tipo,
            is_active=True,
            is_deleted=False,
            empresa_id=EMPRESA_ID
        )
        db.add(prod)
        db.flush()
        print(f"  Produto criado: {nome_produto} ({tipo})")
        
    produto_cache[nome_lower] = prod
    return prod

def normalize_familia(fam):
    if fam is None or pd.isna(fam):
        return None
    fam_str = str(fam).strip()
    if not fam_str:
        return None
    fam_lower = fam_str.lower()
    if fam_lower in ["audio", "áudio", "combinaço c/áudio", "combinação c/áudio"]:
        return "Áudio"
    if fam_lower in ["cordas"]:
        return "Cordas"
    if fam_lower in ["baterias"]:
        return "Baterias"
    if fam_lower in ["mix"]:
        return "Mix"
    if fam_lower in ["teclas"]:
        return "Teclas"
    if fam_lower in ["sopro"]:
        return "Sopro"
    if fam_lower in ["serviços", "servios"]:
        return "Serviços"
    if fam_lower in ["frete"]:
        return "Frete"
    if fam_lower in ["combinação", "combinao"]:
        return "Combinação"
    return fam_str.capitalize()

def configure_pdv(db: Session):
    """Ensures pdv_config is set for company 27 with the canal_venda and familia custom fields."""
    print("Configurando pdv_config para a empresa 27...")
    emp = db.get(Empresa, EMPRESA_ID)
    if not emp:
        print("Empresa Rosario Belem (27) não encontrada!")
        sys.exit(1)
        
    existing_active = []
    if emp.pdv_config:
        try:
            parsed = json.loads(emp.pdv_config)
            existing_active = parsed.get("active_apps") or []
        except Exception:
            pass
            
    active_apps_set = set(existing_active)
    active_apps_set.add("pdv_estoque")
    active_apps_set.add("movimentacao_pdv")
        
    pdv_config_dict = {
        "categorias": {
            "cartao_credito_vista": "3012",
            "cartao_credito_parcelado": "3012",
            "cartao_debito": "3013",
            "dinheiro": "3011",
            "pix_chave": "3017",
            "pix_qr": "3018",
            "boleto": "3015"
        },
        "marcar_como_pago": {
            "dinheiro": True,
            "pix_chave": True,
            "pix_qr": True
        },
        "contas": {
            "dinheiro": "210",
            "pix_chave": "198",
            "pix_qr": "198",
            "cartao_debito": "198",
            "cartao_credito_vista": "198",
            "cartao_credito_parcelado": "198",
            "boleto": "198"
        },
        "formas_pagamento": [
            {"key": "dinheiro", "label": "Dinheiro", "parcelada": False},
            {"key": "pix_chave", "label": "Pix", "parcelada": False},
            {"key": "cartao_credito_vista", "label": "Crédito à Vista", "parcelada": False},
            {"key": "cartao_credito_parcelado", "label": "Crédito Parcelado", "parcelada": True},
            {"key": "cartao_debito", "label": "Débito", "parcelada": False},
            {"key": "boleto", "label": "Boleto", "parcelada": False}
        ],
        "active_apps": list(active_apps_set),
        "centro_custo_padrao_id": 53,
        "pdv_centro_custo_padrao_id": 53,
        "campos_personalizados": [
            {
                "id": "canal_venda",
                "label": "Canal de Venda",
                "type": "select",
                "required": False,
                "options": ["Loja", "WhatsApp", "Redes Sociais", "Site", "Trafego pago", "Indicações", "Loja/Wapp"],
                "is_active": True
            },
            {
                "id": "familia",
                "label": "Família",
                "type": "select",
                "required": False,
                "options": ["Áudio", "Cordas", "Baterias", "Mix", "Teclas", "Sopro", "Serviços", "Frete", "Combinação"],
                "is_active": True
            }
        ]
    }
    
    emp.pdv_config = json.dumps(pdv_config_dict)
    db.add(emp)
    db.commit()
    print("pdv_config salva com sucesso!")

def main():
    parser = argparse.ArgumentParser(description="Atualiza lançamentos e backfill vendas do PDV da empresa Rosario Belem")
    parser.add_argument("--file", required=True, help="Caminho para o arquivo Excel BD_Comercial_Belem.xlsx")
    args = parser.parse_args()
    
    if not os.path.exists(args.file):
        print(f"Erro: Arquivo Excel não encontrado em {args.file}")
        sys.exit(1)
        
    print(f"Lendo planilha Excel {args.file}...")
    df_com = pd.read_excel(args.file, sheet_name="BD_Comercial")
    df_recto = pd.read_excel(args.file, sheet_name="BD_FormaRecto")
    
    print(f"BD_Comercial: {len(df_com)} linhas, BD_FormaRecto: {len(df_recto)} linhas.")
    
    # Map IdVenda -> Canal de Vendas
    sales_channel_map = {}
    sales_observations_map = {}
    for _, row in df_com.iterrows():
        id_venda = row.get("IdVenda")
        if pd.isna(id_venda):
            continue
        id_venda = str(id_venda).strip()
        canal = row.get("Canal de Vendas")
        obs = row.get("Observações")
        if not pd.isna(canal):
            sales_channel_map[id_venda] = str(canal).strip()
        if not pd.isna(obs):
            sales_observations_map[id_venda] = str(obs).strip()
            
    # Group BD_Comercial rows by IdVenda (Items)
    vendas_com_rows = defaultdict(list)
    for _, row in df_com.iterrows():
        id_venda = row.get("IdVenda")
        if pd.isna(id_venda):
            continue
        id_venda = str(id_venda).strip()
        vendas_com_rows[id_venda].append(row)

    # Group BD_FormaRecto rows by IdVenda (Payments)
    vendas_recto_rows = defaultdict(list)
    for _, row in df_recto.iterrows():
        id_venda = row.get("IdVenda")
        if pd.isna(id_venda):
            continue
        id_venda = str(id_venda).strip()
        vendas_recto_rows[id_venda].append(row)
        
    print(f"Mapeados {len(sales_channel_map)} canais de venda, {len(vendas_com_rows)} vendas na BD_Comercial e {len(vendas_recto_rows)} vendas na BD_FormaRecto.")
    
    # Configure pdv_config first
    with Session(engine) as db:
        configure_pdv(db)
        
    # Phase 1: Load all existing launches with origem='PDV' for idempotency
    vendedor_cache = {}
    cliente_cache = {}
    produto_cache = {}
    imported_legacy_ids = set()
    imported_rvs = set()
    legacy_venda_to_launches = defaultdict(list)
    
    print("Buscando lançamentos existentes no banco de dados...")
    with Session(engine) as db:
        # Prepopulate caches
        for u in db.exec(select(Usuario).where(Usuario.empresa_id == EMPRESA_ID)).all():
            vendedor_cache[u.nome.lower()] = u
        for c in db.exec(select(Entidade).where(Entidade.empresa_id == EMPRESA_ID)).all():
            cliente_cache[c.nome.lower()] = c
        for p in db.exec(select(Produto).where(Produto.empresa_id == EMPRESA_ID, Produto.is_deleted == False)).all():
            produto_cache[p.nome.lower()] = p
            
        launches = db.exec(select(Lancamento).where(Lancamento.empresa_id == EMPRESA_ID, Lancamento.origem == "PDV", Lancamento.is_deleted == False)).all()
        for l in launches:
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                    if isinstance(meta, dict):
                        lid = meta.get("legacy_id_venda")
                        if lid:
                            imported_legacy_ids.add(lid)
                            legacy_venda_to_launches[lid].append(l)
                        rv = meta.get("rv")
                        if rv:
                            imported_rvs.add(rv.strip().upper())
                except Exception:
                    pass
            if l.descricao:
                m = re.search(r'RV-([A-Z0-9-]+)', l.descricao)
                if m:
                    imported_rvs.add(f"RV-{m.group(1)}".strip().upper())
                    
    print(f"Encontradas {len(legacy_venda_to_launches)} vendas legadas importadas no banco.")
    
    # Phase 2 & 3: Batch Update existing launches and backfill PdvVenda/PdvVendaItem
    print("Atualizando lançamentos antigos e preenchendo tabelas do PDV (PdvVenda/PdvVendaItem)...")
    batch_size = 1000
    db = Session(engine)
    try:
        sales_keys = list(legacy_venda_to_launches.keys())
        total_sales_to_update = len(sales_keys)
        
        updated_launches_cnt = 0
        backfilled_sales_cnt = 0
        
        for idx, legacy_id_venda in enumerate(sales_keys, 1):
            launches_list = legacy_venda_to_launches[legacy_id_venda]
            canal_venda = sales_channel_map.get(legacy_id_venda)
            
            # 1. Update Lancamento observacao with is_direct_sale and campos_extras
            pdv_venda_id = None
            first_launch = launches_list[0]
            
            # Try parsing metadata from first launch
            try:
                meta = json.loads(first_launch.observacao)
                pdv_venda_id = meta.get("pdv_venda_id")
            except Exception:
                pass
                
            if not pdv_venda_id:
                # Generate a fallback UUID if somehow missing
                import uuid
                pdv_venda_id = str(uuid.uuid4())
                
            excel_rows = vendas_com_rows.get(legacy_id_venda)
            familia = excel_rows[0].get("Familia") if (excel_rows and len(excel_rows) > 0) else None
            familia_norm = normalize_familia(familia)
            
            for l in launches_list:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    meta = {}
                meta["is_direct_sale"] = True
                
                campos_extras = {}
                if canal_venda:
                    campos_extras["canal_venda"] = canal_venda
                if familia_norm:
                    campos_extras["familia"] = familia_norm
                    
                meta["campos_extras"] = campos_extras
                meta["pdv_venda_id"] = pdv_venda_id
                
                # Make sure to keep the legacy sale ID
                meta["legacy_id_venda"] = legacy_id_venda
                
                l.observacao = json.dumps(meta)
                db.add(l)
                updated_launches_cnt += 1
                
            # Determine correct sale date from excel row if available
            if excel_rows:
                dt_venda = parse_date(excel_rows[0].get("Data Registro"), excel_rows[0].get("Mes"))
            else:
                dt_venda = first_launch.data_pagamento or first_launch.data_vencimento or date.today()

            # 2. Check and backfill PdvVenda
            venda_op = db.get(PdvVenda, pdv_venda_id)
            if not venda_op:
                # Retrieve fields from the launch observacao metadata
                try:
                    meta = json.loads(first_launch.observacao)
                except Exception:
                    meta = {}
                    
                entidade_id = meta.get("entidade_id") or first_launch.entidade_id
                vendedor_id = meta.get("vendedor_id") or first_launch.created_by_id or first_launch.updated_by_id
                
                # Reconstruct totals
                subtotal = parse_decimal(meta.get("subtotal") or first_launch.valor_previsto)
                desconto = parse_decimal(meta.get("desconto") or 0.0)
                total = parse_decimal(meta.get("total") or subtotal - desconto)
                
                rv_code = meta.get("rv")
                status = meta.get("status") or "REALIZADO"
                obs_text = meta.get("observacao_texto") or f"Importação Legada IdVenda: {legacy_id_venda}"
                
                venda_op = PdvVenda(
                    id=pdv_venda_id,
                    empresa_id=EMPRESA_ID,
                    entidade_id=entidade_id,
                    vendedor_id=vendedor_id,
                    centro_custo_id=CENTRO_CUSTO_ID,
                    data_venda=dt_venda,
                    hora_venda="00:00:00",
                    valor_subtotal=subtotal,
                    valor_desconto=desconto,
                    valor_total=total,
                    status=status,
                    observacao=obs_text,
                    rv=rv_code,
                    is_direct_sale=True
                )
                db.add(venda_op)
                backfilled_sales_cnt += 1
            else:
                # Update existing PdvVenda date with correct sale date
                venda_op.data_venda = dt_venda
                db.add(venda_op)
                backfilled_sales_cnt += 1
                
            # Reconstruct PdvVendaItem from BD_Comercial rows (vendas_com_rows) to match correct items
            # Delete any existing items for this PdvVenda first
            existing_items = db.exec(select(PdvVendaItem).where(PdvVendaItem.venda_id == pdv_venda_id)).all()
            for it in existing_items:
                db.delete(it)
                
            # Add correct items from BD_Comercial rows
            com_rows = vendas_com_rows.get(legacy_id_venda)
            if com_rows:
                for r in com_rows:
                    familia = r.get("Familia")
                    sub_familia = r.get("Sub Familia")
                    qtde = parse_decimal(r.get("Qtde") or 1.00)
                    preco_unit = parse_decimal(r.get("Valor Cheio") or r.get("Valor Final") or 0.00)
                    desc_item = parse_decimal(r.get("Desconto") or 0.00)
                    subtotal_item = parse_decimal(r.get("Valor Final") or (preco_unit * qtde) - desc_item)
                    
                    prod = obter_ou_criar_produto(db, familia, sub_familia, produto_cache)
                    db.add(PdvVendaItem(
                        venda_id=pdv_venda_id,
                        produto_id=prod.id,
                        quantidade=qtde,
                        preco_unitario=preco_unit,
                        desconto=desc_item,
                        subtotal=subtotal_item
                    ))
            else:
                # Fallback to metadata items if Excel sheet doesn't have it
                try:
                    meta = json.loads(first_launch.observacao)
                except Exception:
                    meta = {}
                itens = meta.get("itens", [])
                for item in itens:
                    prod_id = item.get("produto_id")
                    if not prod_id:
                        prod_name = item.get("nome", "Audio - Acessórios")
                        prod = db.exec(select(Produto).where(Produto.empresa_id == EMPRESA_ID, col(Produto.nome).ilike(prod_name))).first()
                        prod_id = prod.id if prod else 10
                    db.add(PdvVendaItem(
                        venda_id=pdv_venda_id,
                        produto_id=prod_id,
                        quantidade=parse_decimal(item.get("quantidade", 1)),
                        preco_unitario=parse_decimal(item.get("preco_unitario", 0)),
                        desconto=parse_decimal(item.get("desconto", 0)),
                        subtotal=parse_decimal(item.get("subtotal", 0))
                    ))
                
            # Commit batch
            if idx % batch_size == 0:
                db.commit()
                print(f"  Progresso: {idx}/{total_sales_to_update} lançamentos/vendas processados e commitados.")
                
        db.commit()
        print(f"Lançamentos atualizados: {updated_launches_cnt}, Vendas operacionais preenchidas: {backfilled_sales_cnt}.")
    except Exception as e:
        db.rollback()
        print("Erro durante a atualização dos lançamentos:", e)
        sys.exit(1)
    finally:
        db.close()
        
    # Phase 4: Import New Sales
    print("\nProcessando novas vendas do Excel (não importadas antes)...")
    new_sales_cnt = 0
    new_launches_cnt = 0
    
    db = Session(engine)
    try:
        # Get cost center Belém
        cc = db.get(CentroCusto, CENTRO_CUSTO_ID)
        if not cc:
            cc = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == EMPRESA_ID, col(CentroCusto.nome).ilike("BELÉM"))).first()
        cc_id = cc.id if cc else CENTRO_CUSTO_ID
        
        for idx, (legacy_id_venda, com_rows) in enumerate(vendas_com_rows.items(), 1):
            if legacy_id_venda in imported_legacy_ids:
                continue
                
            primeira_linha = com_rows[0]
            nome_vendedor = primeira_linha.get("Vendedor")
            if not pd.isna(nome_vendedor) and str(nome_vendedor).strip().lower() == "loja":
                # Ignored vendor
                continue
                
            nome_cliente = primeira_linha.get("Nome do Cliente")
            data_venda = parse_date(primeira_linha.get("Data Registro"), primeira_linha.get("Mes"))
            rv_original = primeira_linha.get("Nº RV")
            
            # Resolve RV code suffixing
            if not pd.isna(rv_original) and str(rv_original).strip():
                try:
                    rv_val = float(rv_original)
                    base_rv = f"RV-{int(rv_val):06d}"
                except Exception:
                    base_rv = f"RV-{str(rv_original).strip()}"
                
                rv_code = base_rv
                suffix = 1
                while rv_code.upper() in imported_rvs:
                    suffix += 1
                    rv_code = f"{base_rv}-{suffix}"
                imported_rvs.add(rv_code.upper())
            else:
                rv_code = None
                
            vendedor = obter_ou_criar_vendedor(db, nome_vendedor, vendedor_cache)
            cliente = obter_ou_criar_cliente(db, nome_cliente, cliente_cache) if not pd.isna(nome_cliente) else obter_ou_criar_cliente(db, "", cliente_cache)
            
            # Build items from BD_Comercial rows (com_rows)
            itens_create = []
            total_items_val = Decimal("0.00")
            total_desc_items = Decimal("0.00")
            first_row = com_rows[0] if (com_rows and len(com_rows) > 0) else None
            familia_venda = first_row.get("Familia") if first_row is not None else None
            familia_norm = normalize_familia(familia_venda)
            for r in com_rows:
                familia = r.get("Familia")
                sub_familia = r.get("Sub Familia")
                qtde = parse_decimal(r.get("Qtde") or 1.00)
                preco_unit = parse_decimal(r.get("Valor Cheio") or r.get("Valor Final") or 0.00)
                desc_item = parse_decimal(r.get("Desconto") or 0.00)
                subtotal_item = parse_decimal(r.get("Valor Final") or (preco_unit * qtde) - desc_item)
                
                prod = obter_ou_criar_produto(db, familia, sub_familia, produto_cache)
                itens_create.append(
                    PdvVendaItemCreate(
                        produto_id=prod.id,
                        quantidade=qtde,
                        preco_unitario=preco_unit,
                        desconto=desc_item
                    )
                )
                total_items_val += subtotal_item
                total_desc_items += desc_item
                
            # Build payments from BD_FormaRecto rows (recto_rows)
            pagamentos_create = []
            recto_rows = vendas_recto_rows.get(legacy_id_venda)
            if recto_rows:
                for r in recto_rows:
                    forma_pagto = mapear_forma_pagamento(r.get("Forma Pagto"))
                    valor_pag = parse_decimal(r.get("Valor"))
                    bandeira = r.get("Bandeira", "OUTROS")
                    
                    try:
                        parcelas = int(float(r.get("Qtde Parcelas", 1)))
                    except Exception:
                        parcelas = 1
                    if parcelas <= 0:
                        parcelas = 1
                        
                    pagamentos_create.append(
                        PdvVendaPagamento(
                            tipo_pagamento=forma_pagto,
                            valor=valor_pag,
                            numero_parcelas=parcelas,
                            bandeira=bandeira if not pd.isna(bandeira) else "OUTROS",
                            data_pagamento=data_venda
                        )
                    )
            else:
                # Fallback to single payment using cash
                pagamentos_create.append(
                    PdvVendaPagamento(
                        tipo_pagamento="dinheiro",
                        valor=total_items_val,
                        numero_parcelas=1,
                        bandeira="OUTROS",
                        data_pagamento=data_venda
                    )
                )
            # Guarantee that sum of payments matches expected net value to avoid 400 validation error
            # Expected net value according to backend is total gross (sum of unit_price * qty) minus sale-level discount
            gross_sum = sum(it.preco_unitario * it.quantidade for it in itens_create)
            expected_net = gross_sum - total_desc_items
            total_pagamentos = sum(p.valor for p in pagamentos_create)
            if total_pagamentos != expected_net:
                diff = expected_net - total_pagamentos
                pagamentos_create[-1].valor += diff
                
            # Create PdvVendaCreate payload
            canal_venda = sales_channel_map.get(legacy_id_venda)
            
            campos_extras = {}
            if canal_venda:
                campos_extras["canal_venda"] = canal_venda
            if familia_norm:
                campos_extras["familia"] = familia_norm
                
            venda_in = PdvVendaCreate(
                entidade_id=cliente.id,
                centro_custo_id=cc_id,
                vendedor_id=vendedor.id,
                desconto=total_desc_items,
                status="REALIZADO",
                itens=itens_create,
                pagamentos=pagamentos_create,
                rv=rv_code,
                data_pagamento=data_venda,
                observacao=sales_observations_map.get(legacy_id_venda) or f"Importação Legada IdVenda: {legacy_id_venda}",
                is_direct_sale=True,
                campos_extras=campos_extras
            )
            
            # Create sale via PdvService
            response_venda = PdvService.criar_venda(
                db=db,
                venda_in=venda_in,
                empresa_id=EMPRESA_ID,
                current_user_id=vendedor.id
            )
            
            # Link created launches with legacy_id_venda
            launches_criados = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == EMPRESA_ID,
                    Lancamento.id_parcelamento == response_venda.venda_id_uuid,
                    Lancamento.is_deleted == False
                )
            ).all()
            
            for l in launches_criados:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    meta = {}
                meta["legacy_id_venda"] = legacy_id_venda
                meta["is_direct_sale"] = True
                meta["campos_extras"] = campos_extras
                l.observacao = json.dumps(meta)
                db.add(l)
                new_launches_cnt += 1
                
            new_sales_cnt += 1
            
            if new_sales_cnt % 100 == 0:
                db.commit()
                print(f"  Progresso: {new_sales_cnt} novas vendas importadas.")
                
        db.commit()
        print(f"Importação concluída! Novas vendas importadas: {new_sales_cnt}, Novos lançamentos criados: {new_launches_cnt}.")
    except Exception as e:
        db.rollback()
        print("Erro ao importar novas vendas:", e)
        sys.exit(1)
    finally:
        db.close()
        
    print("\n=== SCRIPT CONCLUÍDO COM SUCESSO ===")
    print(f"Total lançamentos atualizados (Canais de Venda/Venda Direta): {updated_launches_cnt}")
    print(f"Total vendas backfilled (PdvVenda/PdvVendaItem): {backfilled_sales_cnt}")
    print(f"Total novas vendas importadas do Excel: {new_sales_cnt}")

if __name__ == "__main__":
    main()

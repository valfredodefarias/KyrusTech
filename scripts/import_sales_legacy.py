# scripts/import_sales_legacy.py
import os
import sys
import csv
import json
import re
import unicodedata
from datetime import datetime, date
from decimal import Decimal
from collections import defaultdict

# Adicionar o diretório app ao PYTHONPATH
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.centro_custo import CentroCusto
from app.models.lancamento import Lancamento
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.services.pdv_service import PdvService


# Configurações de importação
EMPRESA_ID = 27  # Rosario Belem
CENTRO_CUSTO_ID = 53  # BELÉM
CSV_PATH = r"scripts/BD_Comercial_Belem - BD_FormaRecto.csv"


def parse_date(date_str: str, mes_str: str = "") -> date:
    """Tenta parsear a data do CSV em diversos formatos, inferindo o ano do campo Mes se estiver incompleta."""
    date_str = str(date_str).strip()
    
    # Tratar datas incompletas (ex: "13/08") inferindo o ano de mes_str (ex: "ago./2024")
    if date_str and "/" in date_str and len(date_str.split("/")) == 2:
        year = None
        if mes_str and "/" in mes_str:
            parts = mes_str.split("/")
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
            # Se tiver barra de data, vamos tratar se vier no formato 1/3/24 ou 01/03/24
            if "/" in date_str:
                parts = date_str.split("/")
                if len(parts) == 3:
                    # Garantir dois dígitos no ano se for %y
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
    # Fallback se não conseguir parsear
    return datetime.utcnow().date()


def parse_decimal(val_str: str) -> Decimal:
    """Parseia valor decimal do CSV, tratando separadores de milhar e decimal do padrão brasileiro."""
    val_str = str(val_str).strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(val_str)
    except Exception:
        return Decimal("0.00")


def mapear_forma_pagamento(forma_csv: str) -> str:
    """Mapeia a forma de pagamento do CSV para os tipos internos do Kyrus ERP."""
    forma_csv = str(forma_csv).strip().lower()
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
        return "dinheiro"  # Fallback genérico para Troca/Outros


def clean_email(nome_vendedor: str) -> str:
    n = unicodedata.normalize("NFKD", nome_vendedor.lower())
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r'[^a-z0-9\s_]', '', n)
    n = re.sub(r'\s+', '_', n)
    return f"{n}@kyrus_legado.com"


def obter_ou_criar_vendedor(db: Session, nome_vendedor: str, vendedor_cache: dict) -> Usuario:
    """Busca o vendedor no banco. Se não existir, cria um usuário ativo na empresa."""
    nome_vendedor = str(nome_vendedor).strip()
    if not nome_vendedor:
        nome_vendedor = "Vendedor Legado"
        
    nome_lower = nome_vendedor.lower()
    if nome_lower in vendedor_cache:
        return vendedor_cache[nome_lower]
        
    # Buscar usuário pelo nome (case-insensitive)
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
    """Busca a entidade cliente no banco. Se não existir, cria."""
    nome_cliente = str(nome_cliente).strip()
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
    """Busca o produto genérico por Família/Subfamília. Se não existir, cria."""
    familia = str(familia).strip()
    sub_familia = str(sub_familia).strip()
    
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
        tipo = "SERVICO" if familia.lower() == "serviços" or familia.lower() == "servicos" else "PRODUTO"
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


def importar_csv():
    if not os.path.exists(CSV_PATH):
        print(f"Arquivo CSV não encontrado em: {CSV_PATH}")
        return

    print(f"Iniciando leitura do arquivo CSV: {CSV_PATH}...")
    
    # Agrupar linhas do CSV por IdVenda
    vendas_csv = defaultdict(list)
    
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            id_venda = row.get("IdVenda")
            if id_venda:
                vendas_csv[id_venda].append(row)
                
    total_vendas = len(vendas_csv)
    print(f"Total de vendas únicas encontradas no CSV: {total_vendas}")
    
    importadas = 0
    ignoradas = 0
    erros = 0
    
    vendedor_cache = {}
    cliente_cache = {}
    produto_cache = {}
    imported_legacy_ids = set()
    imported_rvs = set()
    
    # Pre-popular caches
    print("Pre-populando caches de vendedores, clientes e produtos...")
    with Session(engine) as db:
        users = db.exec(select(Usuario).where(Usuario.empresa_id == EMPRESA_ID)).all()
        for u in users:
            vendedor_cache[u.nome.lower()] = u
            
        clientes = db.exec(select(Entidade).where(Entidade.empresa_id == EMPRESA_ID)).all()
        for c in clientes:
            cliente_cache[c.nome.lower()] = c
            
        produtos = db.exec(select(Produto).where(Produto.empresa_id == EMPRESA_ID, Produto.is_deleted == False)).all()
        for p in produtos:
            produto_cache[p.nome.lower()] = p
            
        print("Buscando lançamentos já importados para cache de idempotência e RVs...")
        launches = db.exec(select(Lancamento).where(Lancamento.empresa_id == EMPRESA_ID, Lancamento.is_deleted == False)).all()
        for l in launches:
            # 1. Parse meta JSON
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                    if isinstance(meta, dict):
                        lid = meta.get("legacy_id_venda")
                        if lid:
                            imported_legacy_ids.add(lid)
                        rv = meta.get("rv")
                        if rv:
                            imported_rvs.add(rv.strip().upper())
                except Exception:
                    pass
            # 2. Parse from description as fallback
            if l.descricao:
                m = re.search(r'RV-([A-Z0-9-]+)', l.descricao)
                if m:
                    imported_rvs.add(f"RV-{m.group(1)}".strip().upper())
        print(f"Encontrados {len(imported_legacy_ids)} IDs de venda e {len(imported_rvs)} RVs já importados.")

    # Loop de importação transacionada
    with Session(engine) as db:
        # Carregar ou criar centro de custo
        cc = db.get(CentroCusto, CENTRO_CUSTO_ID)
        if not cc or cc.empresa_id != EMPRESA_ID:
            # Garantir existência do CC Belém
            cc = db.exec(
                select(CentroCusto)
                .where(
                    CentroCusto.empresa_id == EMPRESA_ID,
                    col(CentroCusto.nome).ilike("BELÉM")
                )
            ).first()
            if not cc:
                cc = CentroCusto(nome="BELÉM", empresa_id=EMPRESA_ID)
                db.add(cc)
                db.flush()
            cc_id = cc.id
        else:
            cc_id = CENTRO_CUSTO_ID

        # Sort sales by date descending to prioritize newer sales (e.g. 2026)
        vendas_ordenadas = sorted(
            vendas_csv.items(),
            key=lambda x: parse_date(x[1][0].get("Data Registro", ""), x[1][0].get("Mes", "")),
            reverse=True
        )

        for idx, (legacy_id_venda, rows) in enumerate(vendas_ordenadas, start=1):
            if idx % 500 == 0:
                print(f"Processado: {idx}/{total_vendas} vendas...")

            # 1. Verificar idempotência no cache local
            if legacy_id_venda in imported_legacy_ids:
                ignoradas += 1
                continue

            try:
                # Cada venda do CSV é importada em sua própria transação controlada
                primeira_linha = rows[0]
                nome_vendedor = primeira_linha.get("Vendedor", "Sem Vendedor")
                if nome_vendedor and str(nome_vendedor).strip().lower() == "loja":
                    ignoradas += 1
                    continue
                nome_cliente = primeira_linha.get("Nome do Cliente", "")
                data_venda = parse_date(primeira_linha.get("Data Registro", ""), primeira_linha.get("Mes", ""))
                rv_original = primeira_linha.get("Nº RV", "")
                if rv_original and rv_original.strip():
                    try:
                        rv_val = float(rv_original)
                        base_rv = f"RV-{int(rv_val):06d}"
                    except Exception:
                        base_rv = f"RV-{rv_original.strip()}"
                    
                    # Resolve duplicate RV by checking our in-memory cache
                    rv_code = base_rv
                    suffix_counter = 1
                    while rv_code.upper() in imported_rvs:
                        suffix_counter += 1
                        rv_code = f"{base_rv}-{suffix_counter}"
                    # Registrar o novo RV gerado na memória para que os próximos no mesmo loop não dupliquem
                    imported_rvs.add(rv_code.upper())
                else:
                    rv_code = None

                # Obter ou criar cadastros (usando cache)
                vendedor = obter_ou_criar_vendedor(db, nome_vendedor, vendedor_cache)
                cliente = obter_ou_criar_cliente(db, nome_cliente, cliente_cache)

                # Montar itens e pagamentos
                itens_create = []
                pagamentos_create = []
                
                for r in rows:
                    familia = r.get("Familia", "Audio")
                    sub_familia = r.get("Sub Familia", "Acessórios")
                    valor_linha = parse_decimal(r.get("Valor", "0.00"))
                    
                    forma_pagto = mapear_forma_pagamento(r.get("Forma Pagto", ""))
                    bandeira = r.get("Bandeira", "OUTROS")
                    
                    try:
                        parcelas = int(float(r.get("Qtde Parcelas", "1") or "1"))
                    except Exception:
                        parcelas = 1
                    if parcelas <= 0:
                        parcelas = 1

                    # Auto-cadastro do produto (usando cache)
                    produto = obter_ou_criar_produto(db, familia, sub_familia, produto_cache)

                    # Item da venda fatiada
                    itens_create.append(
                        PdvVendaItemCreate(
                            produto_id=produto.id,
                            quantidade=1,
                            preco_unitario=valor_linha,
                            desconto=Decimal("0.00")
                        )
                    )

                    # Pagamento fatiado
                    pagamentos_create.append(
                        PdvVendaPagamento(
                            tipo_pagamento=forma_pagto,
                            valor=valor_linha,
                            numero_parcelas=parcelas,
                            bandeira=bandeira if bandeira else "OUTROS",
                            data_pagamento=data_venda
                        )
                    )

                # Objeto de entrada da venda do PDV
                venda_in = PdvVendaCreate(
                    entidade_id=cliente.id,
                    centro_custo_id=cc_id,
                    vendedor_id=vendedor.id,
                    desconto=Decimal("0.00"),
                    status="REALIZADO",
                    itens=itens_create,
                    pagamentos=pagamentos_create,
                    rv=rv_code,
                    data_pagamento=data_venda,
                    observacao=f"Importação Legada IdVenda: {legacy_id_venda}"
                )

                # Chamar o PdvService para gerar e persistir os lançamentos financeiros
                response_venda = PdvService.criar_venda(
                    db=db,
                    venda_in=venda_in,
                    empresa_id=EMPRESA_ID,
                    current_user_id=vendedor.id
                )

                # Atualizar os lançamentos criados com o ID do legado na observação
                launches_criados = db.exec(
                    select(Lancamento)
                    .where(
                        Lancamento.empresa_id == EMPRESA_ID,
                        Lancamento.id_parcelamento == response_venda.venda_id_uuid,
                        Lancamento.is_deleted == False
                    )
                ).all()

                for l in launches_criados:
                    meta = json.loads(l.observacao)
                    meta["legacy_id_venda"] = legacy_id_venda
                    l.observacao = json.dumps(meta)
                    db.add(l)

                db.commit()
                imported_legacy_ids.add(legacy_id_venda)
                importadas += 1

            except Exception as e:
                db.rollback()
                print(f"Erro ao importar venda ID {legacy_id_venda}: {str(e)}")
                erros += 1

    print("\n--- RESUMO DA IMPORTAÇÃO ---")
    print(f"Total de vendas processadas: {total_vendas}")
    print(f"Vendas importadas com sucesso: {importadas}")
    print(f"Vendas ignoradas (já importadas): {ignoradas}")
    print(f"Vendas com erro: {erros}")


if __name__ == "__main__":
    importar_csv()

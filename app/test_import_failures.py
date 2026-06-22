import csv
import json
import os
from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.centro_custo import CentroCusto
from app.models.lancamento import Lancamento
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.services.pdv_service import PdvService
from scripts.import_sales_legacy import parse_date, parse_decimal, mapear_forma_pagamento, obter_ou_criar_vendedor, obter_ou_criar_cliente, obter_ou_criar_produto

CSV_PATH = r"scripts/BD_Comercial_Belem - BD_FormaRecto.csv"
EMPRESA_ID = 27
CENTRO_CUSTO_ID = 53

def run():
    if not os.path.exists(CSV_PATH):
        print(f"CSV not found at: {CSV_PATH}")
        return
        
    print("CSV file found!")
    
    # Extract rows for those legacy IDs
    vendas_csv = {}
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            id_venda = row.get("IdVenda")
            if id_venda in ["10c72500", "7a9a7db9"]:
                vendas_csv.setdefault(id_venda, []).append(row)
                
    print(f"Found rows in CSV for target IDs: {list(vendas_csv.keys())}")
    
    vendedor_cache = {}
    cliente_cache = {}
    produto_cache = {}
    
    with Session(engine) as db:
        for lid, rows in vendas_csv.items():
            print(f"\nProcessing legacy ID: {lid}")
            try:
                primeira_linha = rows[0]
                nome_vendedor = primeira_linha.get("Vendedor", "Sem Vendedor")
                nome_cliente = primeira_linha.get("Nome do Cliente", "")
                data_venda = parse_date(primeira_linha.get("Data Registro", ""), primeira_linha.get("Mes", ""))
                rv_original = primeira_linha.get("Nº RV", "")
                if rv_original and rv_original.strip():
                    try:
                        rv_val = float(rv_original)
                        rv_code = f"RV-{int(rv_val):06d}"
                    except Exception:
                        rv_code = f"RV-{rv_original.strip()}"
                else:
                    rv_code = None
                
                print(f"  Vendedor: {nome_vendedor} | Cliente: {nome_cliente} | RV: {rv_code} | Data: {data_venda}")
                
                vendedor = obter_ou_criar_vendedor(db, nome_vendedor, vendedor_cache)
                cliente = obter_ou_criar_cliente(db, nome_cliente, cliente_cache)
                
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
                        
                    produto = obter_ou_criar_produto(db, familia, sub_familia, produto_cache)
                    itens_create.append(
                        PdvVendaItemCreate(
                            produto_id=produto.id,
                            quantidade=1,
                            preco_unitario=valor_linha,
                            desconto=0.0
                        )
                    )
                    pagamentos_create.append(
                        PdvVendaPagamento(
                            tipo_pagamento=forma_pagto,
                            valor=valor_linha,
                            numero_parcelas=parcelas,
                            bandeira=bandeira if bandeira else "OUTROS",
                            data_pagamento=data_venda
                        )
                    )
                    
                venda_in = PdvVendaCreate(
                    entidade_id=cliente.id,
                    centro_custo_id=CENTRO_CUSTO_ID,
                    vendedor_id=vendedor.id,
                    desconto=0.0,
                    status="REALIZADO",
                    itens=itens_create,
                    pagamentos=pagamentos_create,
                    rv=rv_code,
                    data_pagamento=data_venda,
                    observacao=f"Importação Legada IdVenda: {lid}"
                )
                
                print("  Trying to create sale in PDV...")
                response_venda = PdvService.criar_venda(
                    db=db,
                    venda_in=venda_in,
                    empresa_id=EMPRESA_ID,
                    current_user_id=vendedor.id
                )
                print(f"  Successfully created sale: {response_venda.venda_id_uuid}")
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"  FAILED to import: {str(e)}")

if __name__ == "__main__":
    run()

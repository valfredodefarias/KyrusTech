# scripts/sync_legacy_system.py
import os
import sys
import csv
from decimal import Decimal

# Add root dir to sys path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.meta_vendedor import MetaVendedor
from scripts.import_sales_legacy import clean_email, obter_ou_criar_vendedor, importar_csv

METAS_CSV_PATH = r"scripts/BD_Comercial_Belem - Bs.csv"
SALES_CSV_PATH = r"scripts/BD_Comercial_Belem - BD_FormaRecto.csv"
EMPRESA_ID = 27

def parse_decimal(val_str):
    val_str = str(val_str).strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(val_str)
    except Exception:
        return Decimal("0.00")

def sync_metas_and_users():
    if not os.path.exists(METAS_CSV_PATH):
        print(f"Metas CSV not found at: {METAS_CSV_PATH}")
        return
        
    print(f"Reading metas from {METAS_CSV_PATH}...")
    
    with Session(engine) as db:
        # Load all sellers for cache
        vendedor_cache = {}
        users = db.exec(select(Usuario).where(Usuario.empresa_id == EMPRESA_ID)).all()
        for u in users:
            vendedor_cache[u.nome.lower()] = u
            
        with open(METAS_CSV_PATH, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                nome = row.get("Nome")
                if not nome:
                    continue
                nome = nome.strip()
                
                # Ignore aggregate rows and fake users
                if nome.lower() in ("loja", "audio", "rosário belém", "rosario belã©m", "rosario belém", ""):
                    continue
                    
                meta_val = parse_decimal(row.get("Meta", "0.00"))
                print(f"Processing seller: {nome} | Meta: {meta_val}")
                
                # 1. Get or create seller
                vendedor = obter_ou_criar_vendedor(db, nome, vendedor_cache)
                
                # 2. Get or create MetaVendedor
                query = (
                    select(MetaVendedor)
                    .where(
                        MetaVendedor.empresa_id == EMPRESA_ID,
                        MetaVendedor.vendedor_id == vendedor.id,
                        MetaVendedor.mes == 6,
                        MetaVendedor.ano == 2026,
                        MetaVendedor.is_deleted == False
                    )
                )
                meta_db = db.exec(query).first()
                
                if meta_db:
                    meta_db.valor_meta = meta_val
                    db.add(meta_db)
                    print(f"  Updated MetaVendedor ID {meta_db.id} to {meta_val}")
                else:
                    meta_db = MetaVendedor(
                        empresa_id=EMPRESA_ID,
                        vendedor_id=vendedor.id,
                        mes=6,
                        ano=2026,
                        valor_meta=meta_val
                    )
                    db.add(meta_db)
                    db.flush()
                    print(f"  Created MetaVendedor ID {meta_db.id} with meta {meta_val}")
                    
        db.commit()
    print("Metas and users synchronized successfully!\n")

def run():
    sync_metas_and_users()
    print("Running sales import...")
    importar_csv()
    print("Sales import finished!")

if __name__ == "__main__":
    run()

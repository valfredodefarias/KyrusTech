import os
import sys
import pandas as pd
from pathlib import Path
from datetime import datetime, date
from decimal import Decimal
from collections import defaultdict

# Root of the ERP project in the container
sys.path.insert(0, "/app")

from sqlmodel import Session, create_engine, select, or_
from app.core.config import settings
from app.models.lancamento import Lancamento
from app.models.conta import Conta

# Normalize date helper
def to_date(val):
    if pd.isna(val):
        return None
    if isinstance(val, (datetime, date)):
        return val.date() if isinstance(val, datetime) else val
    try:
        dt = pd.to_datetime(val)
        return dt.date()
    except:
        return None

# Normalize decimal helper
def to_decimal(val):
    if pd.isna(val):
        return Decimal("0.00")
    return Decimal(f"{float(val):.2f}")

# Normalize description
def clean_desc(desc):
    if pd.isna(desc):
        return ""
    return " ".join(str(desc).strip().lower().split())

# Helper to calculate balance of a bank account exactly like contas.py does
def get_calculated_balance(session, conta_id):
    conta = session.get(Conta, conta_id)
    saldo_inicial = Decimal(str(conta.saldo_inicial or 0))
    
    # Query active paid launches
    query = select(Lancamento).where(
        Lancamento.conta_id == conta_id,
        Lancamento.is_deleted == False,
        or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
        or_(
            Lancamento.observacao.is_(None),
            (~Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%") & ~Lancamento.observacao.ilike('%"legacy_id_venda"%'))
        )
    )
    launches = session.exec(query).all()
    
    total_entradas = Decimal("0.00")
    total_saidas = Decimal("0.00")
    
    for l in launches:
        val = Decimal(str(l.valor_pago or 0))
        tipo = (l.tipo or "").strip().upper()
        if tipo.startswith("R"):
            total_entradas += val
        elif tipo.startswith("D"):
            total_saidas += val
            
    return saldo_inicial + total_entradas - total_saidas

# Main execution block
database_url = str(settings.DATABASE_URL)
engine = create_engine(database_url)

# Find spreadsheet path dynamically
possible_paths = [
    "/app/scripts/Planilha sem título (1).xlsx",
    "/app/backups/Planilha sem título (1).xlsx",
    "scripts/Planilha sem título (1).xlsx",
    "backups/Planilha sem título (1).xlsx"
]

xlsx_path = None
for p in possible_paths:
    if os.path.exists(p):
        xlsx_path = p
        break

if not xlsx_path:
    print("ERROR: Planilha sem título (1).xlsx not found in any expected location!")
    sys.exit(1)

print(f"Loading spreadsheet from: {xlsx_path}")
df_xlsx = pd.read_excel(xlsx_path)

# Parse Excel rows
xlsx_launches = []
for idx, row in df_xlsx.iterrows():
    val_princ = to_decimal(row.get("Valor Principal"))
    dt_venc = to_date(row.get("Data Vcto"))
    
    xlsx_launches.append({
        "id_financeiro": str(row.get("IdFinanceiro")),
        "descricao": str(row.get("Descrição")),
        "clean_desc": clean_desc(row.get("Descrição")),
        "valor_principal": val_princ,
        "data_vencimento": dt_venc,
        "tipo": "RECEITA" if str(row.get("Tipo")).lower() in ["recebimento", "receita"] else "DESPESA",
        "row_index": idx
    })

with Session(engine) as session:
    # 1. Query database launches for company 31 in Feb 2026
    start_date = date(2026, 2, 1)
    end_date = date(2026, 2, 28)
    
    db_query = (
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 31,
            Lancamento.is_deleted == False,
            (
                ((Lancamento.data_vencimento >= start_date) & (Lancamento.data_vencimento <= end_date)) |
                ((Lancamento.data_pagamento >= start_date) & (Lancamento.data_pagamento <= end_date)) |
                ((Lancamento.data_competencia >= start_date) & (Lancamento.data_competencia <= end_date))
            )
        )
    )
    db_launches = session.exec(db_query).all()
    
    # 2. Strict 1-to-1 matching
    unmatched_db = {l.id: l for l in db_launches}
    xlsx_to_db = {}
    
    # Match Strategy 1: Exact match by referencia_externa == id_financeiro
    for x in xlsx_launches:
        match_candidate_id = None
        for db_id, db_l in unmatched_db.items():
            if db_l.referencia_externa == x["id_financeiro"]:
                match_candidate_id = db_id
                break
        if match_candidate_id:
            xlsx_to_db[x["row_index"]] = unmatched_db.pop(match_candidate_id)
            
    # Match Strategy 2: Exact match by tipo, valor, data_venc, and description
    for x in xlsx_launches:
        if x["row_index"] in xlsx_to_db:
            continue
        match_candidate_id = None
        for db_id, db_l in unmatched_db.items():
            if (db_l.tipo == x["tipo"] and 
                round(float(db_l.valor_previsto), 2) == round(float(x["valor_principal"]), 2) and
                db_l.data_vencimento == x["data_vencimento"] and
                clean_desc(db_l.descricao) == x["clean_desc"]):
                match_candidate_id = db_id
                break
        if match_candidate_id:
            xlsx_to_db[x["row_index"]] = unmatched_db.pop(match_candidate_id)

    # Match Strategy 3: Relaxed match (similar description)
    for x in xlsx_launches:
        if x["row_index"] in xlsx_to_db:
            continue
        match_candidate_id = None
        for db_id, db_l in unmatched_db.items():
            if (db_l.tipo == x["tipo"] and 
                round(float(db_l.valor_previsto), 2) == round(float(x["valor_principal"]), 2) and
                db_l.data_vencimento == x["data_vencimento"]):
                c_desc = clean_desc(db_l.descricao)
                if x["clean_desc"] in c_desc or c_desc in x["clean_desc"]:
                    match_candidate_id = db_id
                    break
        if match_candidate_id:
            xlsx_to_db[x["row_index"]] = unmatched_db.pop(match_candidate_id)

    # Match Strategy 4: Very relaxed match (same type, value, date)
    for x in xlsx_launches:
        if x["row_index"] in xlsx_to_db:
            continue
        match_candidate_id = None
        for db_id, db_l in unmatched_db.items():
            if (db_l.tipo == x["tipo"] and 
                round(float(db_l.valor_previsto), 2) == round(float(x["valor_principal"]), 2) and
                db_l.data_vencimento == x["data_vencimento"]):
                match_candidate_id = db_id
                break
        if match_candidate_id:
            xlsx_to_db[x["row_index"]] = unmatched_db.pop(match_candidate_id)

    # 3. Identify launch IDs to soft-delete
    ids_to_delete = set()
    
    # Delete database launches matched to Excel rows with -UNK ID
    for x in xlsx_launches:
        if x["id_financeiro"].endswith("-UNK"):
            matched_db_launch = xlsx_to_db.get(x["row_index"])
            if matched_db_launch:
                ids_to_delete.add(matched_db_launch.id)
                
    # Also add the database duplicate 277864
    extra_dup_id = 277864
    db_dup = session.get(Lancamento, extra_dup_id)
    if db_dup and not db_dup.is_deleted:
        ids_to_delete.add(extra_dup_id)
        
    print(f"Total launch IDs selected for soft-delete: {len(ids_to_delete)}")
    print(f"IDs to delete: {sorted(list(ids_to_delete))}")

    # 4. Save original bank balances
    accounts = session.exec(select(Conta).where(Conta.empresa_id == 31)).all()
    original_balances = {}
    for acc in accounts:
        original_balances[acc.id] = get_calculated_balance(session, acc.id)
        print(f"Account ID: {acc.id} | Name: '{acc.nome}' | Original Balance: R$ {original_balances[acc.id]:,.2f} | Stored Saldo Inicial: R$ {acc.saldo_inicial:,.2f}")

    # 5. Calculate delta and apply soft delete
    # Group deleted launches by account to compute delta
    deleted_launches_by_acc = defaultdict(list)
    
    for l_id in ids_to_delete:
        l = session.get(Lancamento, l_id)
        if l:
            # Check if it influences balance (is paid)
            influences = l.status == "PAGO" or l.data_pagamento is not None
            obs = l.observacao or ""
            if "DestinoCompra DEMONSTRACAO" in obs or "legacy_id_venda" in obs:
                influences = False
                
            if influences and l.conta_id:
                deleted_launches_by_acc[l.conta_id].append(l)
            
            # Apply soft delete
            l.is_deleted = True
            l.deleted_at = datetime.utcnow()
            l.updated_at = datetime.utcnow()
            session.add(l)

    # 6. Adjust saldo_inicial for each affected account
    # Formula: saldo_inicial_new = saldo_inicial_old + sum(receitas_deletadas) - sum(despesas_deletadas)
    for acc_id, l_list in deleted_launches_by_acc.items():
        acc = session.get(Conta, acc_id)
        
        delta_receitas = Decimal("0.00")
        delta_despesas = Decimal("0.00")
        
        for l in l_list:
            val = Decimal(str(l.valor_pago or 0))
            tipo = (l.tipo or "").strip().upper()
            if tipo.startswith("R"):
                delta_receitas += val
            elif tipo.startswith("D"):
                delta_despesas += val
                
        delta = delta_receitas - delta_despesas
        print(f"Adjusting Account ID: {acc_id} | Name: '{acc.nome}':")
        print(f"  Deleted Paid Receitas: R$ {delta_receitas:,.2f}")
        print(f"  Deleted Paid Despesas: R$ {delta_despesas:,.2f}")
        print(f"  Delta = +{delta_receitas} - {delta_despesas} = R$ {delta:,.2f}")
        
        acc.saldo_inicial = Decimal(str(acc.saldo_inicial)) + delta
        session.add(acc)

    session.flush()

    # 7. Verification: check that the final balances match the initial ones
    all_matched = True
    print("\n=== VERIFICAÇÃO FINAL DOS SALDOS ===")
    for acc in accounts:
        final_bal = get_calculated_balance(session, acc.id)
        orig_bal = original_balances[acc.id]
        diff = final_bal - orig_bal
        print(f"Account ID: {acc.id} | Name: '{acc.nome}':")
        print(f"  Original Balance: R$ {orig_bal:,.2f}")
        print(f"  New Calculated Balance: R$ {final_bal:,.2f}")
        print(f"  Difference: R$ {diff:,.2f}")
        print(f"  Stored Saldo Inicial Adjusted: R$ {acc.saldo_inicial:,.2f}")
        if abs(diff) > Decimal("0.001"):
            all_matched = False
            
    if all_matched:
        print("\nSUCCESS: All balances match perfectly! Committing transaction...")
        session.commit()
        print("Transaction committed successfully.")
    else:
        print("\nERROR: Balances do not match! Rolling back transaction...")
        session.rollback()
        sys.exit(1)

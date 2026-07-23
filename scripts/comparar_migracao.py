import json
import pandas as pd
from datetime import datetime, date
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta

def run():
    session = Session(engine)
    
    # 1. Carregar planilha
    import os
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    excel_path = os.path.join(base_dir, "backups", "Base_PizzaFabioUmarizal.xlsx")
    print(f"Carregando planilha de {excel_path}...")
    df = pd.read_excel(excel_path, sheet_name="Tb_Financeira")
    print(f"Planilha carregada. Total de linhas: {len(df)}")
    
    # Filtrar lançamentos da planilha antes de 14/07/2026
    df["Data Vcto"] = pd.to_datetime(df["Data Vcto"])
    df_old = df[df["Data Vcto"] < "2026-07-14"]
    print(f"Lançamentos na planilha antes de 14/07: {len(df_old)}")
    
    # 2. Carregar do banco de dados (empresa 35)
    db_lances = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.data_vencimento < '2026-07-14',
            Lancamento.is_deleted == False
        )
    ).all()
    print(f"Lançamentos no banco de dados antes de 14/07: {len(db_lances)}")
    
    # Criar mapeamento do banco para comparação
    # Como a planilha tem uma coluna 'IdFinanceiro' (que foi importada para import_hash ou similar?)
    # Vamos ver se import_hash contém o IdFinanceiro da planilha!
    # Let's print some db launches import_hash to verify.
    sample_hash = [l.import_hash for l in db_lances if l.import_hash][:5]
    print("Exemplos de import_hash no banco:", sample_hash)
    
    # Mapear lançamentos da planilha por IdFinanceiro
    sheet_by_id = {str(row["IdFinanceiro"]).strip(): row for _, row in df_old.iterrows()}
    
    # Comparar com status normalizado
    mismatches = []
    
    def normalize_status(st):
        st = str(st).strip().upper()
        if st in ["PAGO", "LIQUIDADO"]:
            return "PAGO"
        return "PENDENTE"

    for l in db_lances:
        h = (l.import_hash or "").strip()
        if not h:
            continue
        if h.startswith("legacy-"):
            h = h[7:]
        if h in sheet_by_id:
            row = sheet_by_id[h]
            sheet_status = normalize_status(row["Situa\u00e7\u00e3o"])
            db_status = normalize_status(l.status)
            
            if db_status != sheet_status:
                mismatches.append({
                    "id": l.id,
                    "tipo": l.tipo,
                    "descricao": l.descricao,
                    "valor": float(l.valor_previsto),
                    "vencimento": l.data_vencimento,
                    "import_hash": h,
                    "sheet_status": str(row["Situa\u00e7\u00e3o"]).strip().upper(),
                    "db_status": l.status.upper(),
                    "db_banco_id": l.conta_id,
                    "sheet_banco": str(row["Banco"]).strip()
                })
                
    print(f"\nTotal de divergências REAIS encontradas: {len(mismatches)}")
    
    # Agrupar divergências por mês de vencimento
    from collections import defaultdict
    by_month = defaultdict(list)
    for m in mismatches:
        month_key = m["vencimento"].strftime("%Y-%m")
        by_month[month_key].append(m)
        
    for month_key in sorted(by_month.keys()):
        print(f"\nMês: {month_key} -> {len(by_month[month_key])} divergências")
        for m in by_month[month_key][:5]:
            print(f"  ID {m['id']} | Tipo: {m['tipo']} | Desc: {m['descricao']} | Vcto: {m['vencimento']} | Planilha: {m['sheet_status']} | BancoDB: {m['db_status']}")

if __name__ == "__main__":
    run()

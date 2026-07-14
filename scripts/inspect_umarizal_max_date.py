"""Investiga max date na planilha Umarizal vs banco local"""
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

XLSX = r"C:\Users\Ciro\Documents\ERP\KyrusERP\scripts\Base_PizzaFabioUmarizal.xlsx"

# Abre planilha Tb_Movimentacao
print("Lendo Tb_Movimentacao...")
df = pd.read_excel(XLSX, sheet_name="Tb_Movimentacao", dtype=str)
print(f"  Total rows: {len(df):,}")
print(f"  Columns: {list(df.columns)}")

# Identifica coluna de data
date_cols = [c for c in df.columns if 'data' in c.lower() or 'dt' in c.lower() or 'date' in c.lower()]
print(f"  Date columns: {date_cols}")

# Tenta converter datas e achar max
for dc in date_cols[:3]:
    try:
        dates = pd.to_datetime(df[dc], dayfirst=True, errors='coerce')
        valid = dates.dropna()
        if len(valid) > 0:
            print(f"  Col '{dc}': min={valid.min().date()} | max={valid.max().date()} | valid={len(valid):,}")
    except Exception as e:
        print(f"  Col '{dc}': erro {e}")

# Verifica formas de pagamento de cartão
print()
print("Formas de pagamento (Tb_Movimentacao):")
fp_col = next((c for c in df.columns if 'forma' in c.lower() or 'pag' in c.lower()), None)
if fp_col:
    print(df[fp_col].value_counts().head(20).to_string())

# Verifica coluna centro de custo
cc_col = next((c for c in df.columns if 'centro' in c.lower() or 'cc' in c.lower()), None)
if cc_col:
    print(f"\nCentros de custo únicos: {df[cc_col].unique()[:10]}")

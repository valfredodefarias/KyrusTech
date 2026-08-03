import pandas as pd

# Read CSV with semicolon delimiter
df = pd.read_csv('/tmp/Lancamentos_RMUSIC_Julho.csv', sep=';', dtype=str)

# Save to Excel
with pd.ExcelWriter('/tmp/Lancamentos_RMUSIC_Julho.xlsx', engine='xlsxwriter') as writer:
    df.to_excel(writer, index=False, sheet_name='Importacao')

print("✅ XLSX gerado com sucesso!")

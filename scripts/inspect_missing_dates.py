"""Investiga por que dados de Abr-Jul/2026 estão faltando no banco"""
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

XLSX = r"C:\Users\Ciro\Documents\ERP\KyrusERP\scripts\Base_PizzaFabioUmarizal.xlsx"

df = pd.read_excel(XLSX, sheet_name="Tb_Movimentacao", dtype=str)

# Converte data
df['Data_dt'] = pd.to_datetime(df['Data'], dayfirst=True, errors='coerce')
df['CC'] = df['Centro de Custo'].fillna('NaN')
df['FormaPagto'] = df['FormaPagto'].fillna('NaN')

print("=== Distribuição por Centro de Custo e Mês (2026) ===")
df_2026 = df[df['Data_dt'] >= '2026-01-01'].copy()
df_2026['mes'] = df_2026['Data_dt'].dt.to_period('M')
pivot = df_2026.groupby(['mes', 'CC']).size().unstack(fill_value=0)
print(pivot.to_string())

print()
print("=== Registros Abr-Jul/2026 por CC e FormaPagto ===")
df_abr_jul = df[(df['Data_dt'] >= '2026-04-10') & (df['Data_dt'] <= '2026-07-11')].copy()
print(f"Total registros Abr-Jul/2026: {len(df_abr_jul):,}")
print()
pivot2 = df_abr_jul.groupby(['CC', 'FormaPagto']).size().reset_index(name='qtd').sort_values('qtd', ascending=False)
print(pivot2.to_string())

print()
print("=== Últimas 10 linhas do filtro CC=Umarizal ===")
df_uma = df[df['CC'] == 'Umarizal'].sort_values('Data_dt', ascending=False)
print(f"Total CC=Umarizal: {len(df_uma):,}")
print(f"Max date CC=Umarizal: {df_uma['Data_dt'].max()}")
print()
print(df_uma[['Data', 'FormaPagto', 'Bandeira', 'Valor Cheio', 'CC']].head(10).to_string())

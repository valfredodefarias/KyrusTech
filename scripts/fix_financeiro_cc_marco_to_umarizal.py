"""
Identifica e deleta da empresa Marco Salão (ID=39) os lançamentos financeiros
que vieram da planilha Umarizal com CC='Marco' (bug do sistema legado).

Essas entradas têm:
  - empresa_id = 39 (Marco Salão)
  - import_hash = 'legacy-{fin_id}'
  - fin_id pertence à Tb_Financeira de Base_PizzaFabioUmarizal.xlsx com Centro de Custo = 'Marco'

Após deletar, elas serão reimportadas corretamente para empresa 35 (Umarizal)
no próximo run do import com financeiro_filter="".
"""
import pandas as pd
import sys, os
sys.path.insert(0, "/app")
os.environ["DISABLE_AUDIT"] = "1"

from sqlalchemy import text
from app.db.session import engine

# Caminho da planilha (dentro do container = /app/scripts/)
XLSX = "/app/scripts/Base_PizzaFabioUmarizal.xlsx"

print("Lendo Tb_Financeira do arquivo Umarizal...")
df = pd.read_excel(XLSX, sheet_name="Tb_Financeira", dtype=str)
df.columns = [str(c).strip() for c in df.columns]

id_col = "IdFinanceiro"
cc_col = next((c for c in df.columns if "centro" in c.lower()), None)

if not cc_col or id_col not in df.columns:
    print(f"ERRO: colunas esperadas não encontradas. Colunas: {list(df.columns)}")
    sys.exit(1)

# Entradas com CC = 'Marco' na planilha da Umarizal
marco_ids = df[df[cc_col].fillna("").str.strip().str.lower() == "marco"][id_col].dropna().unique()
hashes = [f"legacy-{fid.strip()}" for fid in marco_ids if str(fid).strip()]

print(f"  CC='Marco' na planilha Umarizal: {len(hashes):,} entradas")
print(f"  Exemplos de import_hash: {hashes[:5]}")

with engine.begin() as conn:
    # Conta quantas existem em empresa_id=39
    count = conn.execute(text("""
        SELECT COUNT(*) FROM lancamentos
        WHERE empresa_id = 39
          AND import_hash = ANY(:hashes)
    """), {"hashes": hashes}).scalar()
    print(f"\n  Lançamentos em empresa_id=39 a deletar: {count:,}")

    if count == 0:
        print("  Nada a deletar. Já está correto.")
    else:
        # Deleta
        result = conn.execute(text("""
            DELETE FROM lancamentos
            WHERE empresa_id = 39
              AND import_hash = ANY(:hashes)
        """), {"hashes": hashes})
        print(f"  [OK] Deletados: {result.rowcount:,} lançamentos de empresa_id=39")

    # Também verifica empresa_id=35 para confirmar que esses hashes ainda não existem lá
    count35 = conn.execute(text("""
        SELECT COUNT(*) FROM lancamentos
        WHERE empresa_id = 35
          AND import_hash = ANY(:hashes)
    """), {"hashes": hashes}).scalar()
    print(f"  Já existem em empresa_id=35 (Umarizal): {count35:,}")
    if count35 == 0:
        print("  → Serão importados para Umarizal no próximo run do import.")
    else:
        print("  → Já foram reimportados corretamente.")

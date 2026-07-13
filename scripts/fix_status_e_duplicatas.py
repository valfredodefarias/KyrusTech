"""
Fix de produção: corrige 2 problemas nos lançamentos já importados:

1. Status inválidos ('A VENCER', 'ATRASADO', 'VCTO HOJE') → 'EM ABERTO'
   Esses valores do sistema legado tornam os lançamentos INVISÍVEIS no Kyrus.

2. Deleta duplicatas: receitas PDV importadas do Financeiro (Tb_Financeira)
   que já existem via Tb_Movimentacao (para empresa Umarizal).
   Identificadas pelo import_hash contido nos IDs da planilha com banco 'CAIXA PDV'.
"""
import sys, os
sys.path.insert(0, "/app")
os.environ["DISABLE_AUDIT"] = "1"

from sqlalchemy import text
from app.db.session import engine

EMPRESAS = (35, 37, 39, 40)

with engine.begin() as conn:
    # ----------------------------------------------------------------
    # 1. Corrige status inválidos → EM ABERTO
    # ----------------------------------------------------------------
    result = conn.execute(text("""
        UPDATE lancamentos
        SET status = 'EM ABERTO',
            data_pagamento = NULL,
            valor_pago = 0
        WHERE empresa_id = ANY(:emp)
          AND status IN ('A VENCER', 'ATRASADO', 'VCTO HOJE', 'A RECEBER')
          AND origem = 'WEB'
    """), {"emp": list(EMPRESAS)})
    print(f"[FIX 1] Status inválidos corrigidos → EM ABERTO: {result.rowcount:,} lancamentos")

    # ----------------------------------------------------------------
    # 2. Deleta receitas CAIXA PDV duplicadas (Umarizal / empresa 35)
    #    Identificadas por: origem=WEB, tipo=RECEITA, observacao contém
    #    'Importação Financeiro' e descrição contém PDV/PIX/Moviment
    #    (esses vieram da Tb_Financeira banco='CAIXA PDV UMARIZAL')
    # ----------------------------------------------------------------
    result = conn.execute(text("""
        DELETE FROM lancamentos
        WHERE empresa_id = 35
          AND tipo = 'RECEITA'
          AND origem = 'WEB'
          AND observacao LIKE '%Importação Financeiro%'
          AND (
            descricao ILIKE '%PDV%'
            OR descricao ILIKE '%PIX%PDV%'
            OR descricao ILIKE '%Moviment%PDV%'
            OR descricao ILIKE '%Movimento%'
          )
    """), {})
    print(f"[FIX 2] Receitas duplicadas CAIXA PDV deletadas (empresa 35): {result.rowcount:,} lancamentos")

    # Verificação final
    rows = conn.execute(text("""
        SELECT status, COUNT(*) FROM lancamentos
        WHERE empresa_id = ANY(:emp) AND origem = 'WEB'
        GROUP BY status ORDER BY COUNT(*) DESC
    """), {"emp": list(EMPRESAS)}).all()

    print("\n[VERIFICAÇÃO] Status pós-fix:")
    for r in rows:
        print(f"  {r[0]:<20}: {r[1]:>8,}")

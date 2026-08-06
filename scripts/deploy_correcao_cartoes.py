# scripts/deploy_correcao_cartoes.py
"""
Script consolidado para:
1. Parametrizar as regras de Crédito (D+1 Antecipado) para Pizza Fábio Umarizal (ID 35),
   preservando Pix, iFood e Débito.
2. Limpar os recebíveis fantasmas (parcelas futuras de vendas antigas pré-Agosto) 
   para TODAS as 4 unidades da Pizza Fábio (35, 37, 39, 40).
"""

import sys
import subprocess

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

import os

def load_env(filepath=".env"):
    if not os.path.exists(filepath):
        return
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip().strip("'").strip('"')

load_env()

def run_psql(sql):
    db_user = os.getenv("POSTGRES_USER", "postgres")
    db_name = os.getenv("POSTGRES_DB", "postgres")
    cmd = ["docker", "exec", "db_kyrustech", "psql", "-U", db_user, "-d", db_name, "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode, res.stdout.strip(), res.stderr

def main():
    print("==========================================================================================")
    print("🚀 DEPLOY DE CORREÇÃO: REGRAS DE CARTÃO E LIMPEZA DE PARCELAS FANTASMAS")
    print("==========================================================================================")
    
    # 1. PARAMETRIZAR REGRAS DE CRÉDITO (UMARIZAL - ID 35)
    print("\n1️⃣ Ajustando Regras de Crédito (D+1 Antecipado) para Umarizal (ID 35)...")
    sql_regras = """
        UPDATE regras_cartao
        SET dias_payout = 1,
            modo_parcelamento = 'ANTECIPADO',
            tipo_prazo = 'DIAS_UTEIS',
            fds_proximo_dia_util = true,
            updated_at = NOW()
        WHERE empresa_id = 35
          AND is_deleted = false
          AND tipo_pagamento LIKE 'cartao_credito%'
          AND bandeira != 'IFOOD';
    """
    code, out, err = run_psql(sql_regras)
    if code == 0:
        print(f"✅ Regras parametrizadas com sucesso: {out.strip()}")
    else:
        print(f"❌ Erro ao parametrizar regras: {err.strip()}")
        sys.exit(1)

    # 2. LIMPEZA DE PARCELAS FANTASMAS DE VENDAS ANTIGAS (TODAS AS UNIDADES)
    print("\n2️⃣ Limpando parcelas futuras de vendas pré-Agosto (Unidades: 35, 37, 39, 40)...")
    sql_limpeza = """
        UPDATE pdv_movimentacoes m
        SET is_deleted = true, updated_at = NOW()
        FROM pdv_vendas v
        WHERE m.venda_id = v.id
          AND m.empresa_id IN (35, 37, 39, 40)
          AND m.is_deleted = false
          AND m.forma_pagamento IN ('CREDITO_AVISTA', 'CREDITO_PARCELADO')
          AND v.data_venda < '2026-08-01';
    """
    code, out, err = run_psql(sql_limpeza)
    if code == 0:
        print(f"✅ Parcelas fantasmas arquivadas com sucesso: {out.strip()}")
    else:
        print(f"❌ Erro ao limpar parcelas fantasmas: {err.strip()}")
        sys.exit(1)

    # 3. LIMPEZA DOS LANÇAMENTOS FINANCEIROS ÓRFÃOS GERADOS PELOS FANTASMAS
    print("\n3️⃣ Limpando Lançamentos Financeiros (A Receber) associados às parcelas fantasmas...")
    sql_lancamentos = """
        UPDATE lancamentos
        SET is_deleted = true, updated_at = NOW()
        WHERE empresa_id IN (35, 37, 39, 40)
          AND is_deleted = false
          AND status = 'EM ABERTO'
          AND observacao LIKE '%"grouped_card_launch": true%'
          AND data_competencia < '2026-08-01';
    """
    code, out, err = run_psql(sql_lancamentos)
    if code == 0:
        print(f"✅ Lançamentos fantasmas no Financeiro removidos com sucesso: {out.strip()}")
    else:
        print(f"❌ Erro ao limpar lançamentos financeiros: {err.strip()}")
        sys.exit(1)

    print("\n🎉 SCRIPT FINALIZADO COM SUCESSO!")

if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
Script de correção cirúrgica e segura das categorias importadas incorretamente
para a empresa FastEscova-PA (empresa_id = 67).

Causa Raiz:
- O importador associou '01.03. Pix QRS' com o código 01.03 (Saldo positivo - ID 9333)
  em vez de 01.01.03 (Pix QRS - ID 9287).
- O importador associou '01.04. Débito' com o código 01.04 (Transferência recebida - ID 9331)
  em vez de 01.01.04 (Débito - ID 9288).

Este script:
1. Lê a planilha original de importação (IMPORTACAO_LANCAMENTOS_ANANINDEUA.xlsx).
2. Mapeia exatamente as linhas que eram '01.04. Débito' e '01.03. Pix QRS'.
3. Atualiza exclusivamente os lançamentos da empresa_id indicada via transação atômica.
4. Valida a integridade antes e depois.
"""

import os
import sys
import argparse
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
import openpyxl

sys.stdout.reconfigure(encoding="utf-8")


def get_db_connection():
    host = os.getenv("POSTGRES_SERVER", "localhost")
    port = int(os.getenv("POSTGRES_PORT", "5432"))
    user = os.getenv("POSTGRES_USER", "kyrus_user")
    password = os.getenv("POSTGRES_PASSWORD", "kyrus_pass")
    dbname = os.getenv("POSTGRES_DB", "kyrus_erp")
    return psycopg2.connect(
        host=host, port=port, user=user, password=password, dbname=dbname
    )


def main():
    parser = argparse.ArgumentParser(description="Corrigir categorias importadas da FastEscova-PA")
    parser.add_argument("--empresa-id", type=int, default=67, help="ID da empresa (padrão: 67)")
    parser.add_argument(
        "--planilha",
        type=str,
        default=r"c:\Users\Ciro\Documents\ERP\KyrusERP\backups\IMPORTACAO_LANCAMENTOS_ANANINDEUA.xlsx",
        help="Caminho para o arquivo Excel de importação",
    )
    parser.add_argument("--dry-run", action="store_true", help="Apenas simular sem commitar")
    args = parser.parse_args()

    empresa_id = args.empresa_id
    planilha_path = args.planilha

    print(f"=== INICIANDO CORREÇÃO DE CATEGORIAS ===")
    print(f"Empresa ID: {empresa_id}")
    print(f"Planilha: {planilha_path}")
    print(f"Modo Dry-Run: {args.dry_run}\n")

    if not os.path.exists(planilha_path):
        # Tenta achar caminho relativo ao diretório atual
        alt_path = os.path.join(os.path.dirname(__file__), "..", "backups", "IMPORTACAO_LANCAMENTOS_ANANINDEUA.xlsx")
        if os.path.exists(alt_path):
            planilha_path = alt_path
        else:
            print(f"[ERRO] Planilha não encontrada em: {planilha_path}")
            sys.exit(1)

    # 1. Carregar linhas da planilha
    print(f"[1/4] Lendo planilha {os.path.basename(planilha_path)}...")
    wb = openpyxl.load_workbook(planilha_path, data_only=True)
    ws = wb["Lançamentos"]

    linhas_debito = []
    linhas_pix_qrs = []

    for idx, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        cat = str(r[6] or "").strip()
        if "01.04" in cat or "débito" in cat.lower() or "debito" in cat.lower():
            linhas_debito.append(f"Importado da linha {idx}")
        elif "01.03" in cat or "pix qrs" in cat.lower():
            linhas_pix_qrs.append(f"Importado da linha {idx}")

    print(f"   -> Encontradas {len(linhas_debito)} linhas que são DÉBITO")
    print(f"   -> Encontradas {len(linhas_pix_qrs)} linhas que são PIX QRS")

    # 2. Conectar ao Banco e Resolver Categorias
    print(f"\n[2/4] Conectando ao PostgreSQL e validando categorias da empresa {empresa_id}...")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Buscar categorias da empresa
    cur.execute(
        """
        SELECT id, codigo, nome, tipo 
        FROM plano_contas 
        WHERE empresa_id = %s AND is_deleted = false;
        """,
        (empresa_id,),
    )
    contas = cur.fetchall()

    # Mapear IDs
    id_debito_correto = None
    id_pix_qrs_correto = None
    id_saldo_positivo_errado = None
    id_transf_recebida_errada = None

    for c in contas:
        cod = str(c["codigo"] or "").strip()
        nome = str(c["nome"] or "").strip().lower()
        if cod == "01.01.04" or (cod.startswith("01.01") and "débito" in nome):
            id_debito_correto = c["id"]
        elif cod == "01.01.03" or (cod.startswith("01.01") and "pix qrs" in nome):
            id_pix_qrs_correto = c["id"]
        elif cod == "01.03" and "saldo positivo" in nome:
            id_saldo_positivo_errado = c["id"]
        elif cod == "01.04" and "transferência recebida" in nome:
            id_transf_recebida_errada = c["id"]

    print(f"   -> Categoria Débito Correta (01.01.04):          ID {id_debito_correto}")
    print(f"   -> Categoria Pix QRS Correta (01.01.03):         ID {id_pix_qrs_correto}")
    print(f"   -> Categoria Saldo Positivo (01.03 - Origem):    ID {id_saldo_positivo_errado}")
    print(f"   -> Categoria Transf. Recebida (01.04 - Origem):  ID {id_transf_recebida_errada}")

    if not id_debito_correto or not id_pix_qrs_correto:
        print("[ERRO] Não foi possível encontrar as categorias de destino 01.01.04 e 01.01.03 no plano de contas!")
        conn.close()
        sys.exit(1)

    # 3. Conferência Pré-Update
    print(f"\n[3/4] Analisando lançamentos atuais antes da alteração...")
    cur.execute(
        """
        SELECT count(*) as qtd, sum(valor_pago) as tot 
        FROM lancamentos 
        WHERE empresa_id = %s AND plano_contas_id = %s AND observacao = ANY(%s) AND is_deleted = false;
        """,
        (empresa_id, id_transf_recebida_errada, linhas_debito),
    )
    pre_deb = cur.fetchone()
    print(f"   -> Lançamentos de DÉBITO que estão atualmente como 'Transferência recebida': {pre_deb['qtd']} (Total R$ {pre_deb['tot'] or 0:,.2f})")

    cur.execute(
        """
        SELECT count(*) as qtd, sum(valor_pago) as tot 
        FROM lancamentos 
        WHERE empresa_id = %s AND plano_contas_id = %s AND observacao = ANY(%s) AND is_deleted = false;
        """,
        (empresa_id, id_saldo_positivo_errado, linhas_pix_qrs),
    )
    pre_pix = cur.fetchone()
    print(f"   -> Lançamentos de PIX QRS que estão atualmente como 'Saldo positivo':       {pre_pix['qtd']} (Total R$ {pre_pix['tot'] or 0:,.2f})")

    # 4. Executar Update Atômico
    print(f"\n[4/4] Executando correção atômica...")
    cur.execute("BEGIN;")

    # Update 1: Débito
    cur.execute(
        """
        UPDATE lancamentos
        SET plano_contas_id = %s,
            updated_at = NOW()
        WHERE empresa_id = %s 
          AND plano_contas_id = %s 
          AND observacao = ANY(%s) 
          AND is_deleted = false;
        """,
        (id_debito_correto, empresa_id, id_transf_recebida_errada, linhas_debito),
    )
    upd_debito = cur.rowcount
    print(f"   -> [SUCESSO] Atualizados {upd_debito} lançamentos para '01.01.04 - Débito' (ID {id_debito_correto})")

    # Update 2: Pix QRS
    cur.execute(
        """
        UPDATE lancamentos
        SET plano_contas_id = %s,
            updated_at = NOW()
        WHERE empresa_id = %s 
          AND plano_contas_id = %s 
          AND observacao = ANY(%s) 
          AND is_deleted = false;
        """,
        (id_pix_qrs_correto, empresa_id, id_saldo_positivo_errado, linhas_pix_qrs),
    )
    upd_pix = cur.rowcount
    print(f"   -> [SUCESSO] Atualizados {upd_pix} lançamentos para '01.01.03 - Pix QRS' (ID {id_pix_qrs_correto})")

    if args.dry_run:
        cur.execute("ROLLBACK;")
        print("\n[DRY-RUN] Rollback executado. Nenhuma alteração foi persistida no banco.")
    else:
        cur.execute("COMMIT;")
        print("\n[COMMIT] Alterações persistidas no banco de dados com sucesso!")

    # 5. Validação Pós-Update
    cur.execute(
        """
        SELECT pc.codigo, pc.nome, count(l.id) as qtd, sum(l.valor_pago) as tot
        FROM lancamentos l
        JOIN plano_contas pc ON pc.id = l.plano_contas_id
        WHERE l.empresa_id = %s AND pc.codigo IN ('01.01.03', '01.01.04', '01.03', '01.04') AND l.is_deleted = false
        GROUP BY pc.codigo, pc.nome
        ORDER BY pc.codigo;
        """,
        (empresa_id,),
    )
    pos_res = cur.fetchall()
    print("\n=== VALIDAÇÃO PÓS-CORREÇÃO (Estado das Categorias no ERP) ===")
    for p in pos_res:
        print(f"Código {p['codigo']:8s} | {p['nome']:25s} | Qtd: {p['qtd']:5d} | Total: R$ {p['tot'] or 0:10,.2f}")

    conn.close()
    print("\nConcluído com segurança!")


if __name__ == "__main__":
    main()

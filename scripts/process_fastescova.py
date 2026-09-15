# -*- coding: utf-8 -*-
"""
Processador do backup FASTESCOVA.xlsx para importação no KyrusERP.
Gera 2 documentos prontos e validados:
1. IMPORTACAO_PLANO_DE_CONTAS_FASTESCOVA.xlsx (Para a tela Plano de Contas)
2. IMPORTACAO_LANCAMENTOS_FASTESCOVA.xlsx (Para a tela Importação de Lançamentos)
Também atualiza as cópias principais IMPORTACAO_PLANO_DE_CONTAS.xlsx e IMPORTACAO_LANCAMENTOS.xlsx.
"""

import os
import re
import datetime
import pandas as pd
import openpyxl

BACKUP_PATH = r"c:\Users\Ciro\Documents\ERP\KyrusERP\backups\FASTESCOVA.xlsx"
OUTPUT_DIR = r"c:\Users\Ciro\Documents\ERP\KyrusERP\backups"

PLANO_FAST_OUTPUT = os.path.join(OUTPUT_DIR, "IMPORTACAO_PLANO_DE_CONTAS_FASTESCOVA.xlsx")
LANC_FAST_OUTPUT = os.path.join(OUTPUT_DIR, "IMPORTACAO_LANCAMENTOS_FASTESCOVA.xlsx")

PLANO_MAIN_OUTPUT = os.path.join(OUTPUT_DIR, "IMPORTACAO_PLANO_DE_CONTAS.xlsx")
LANC_MAIN_OUTPUT = os.path.join(OUTPUT_DIR, "IMPORTACAO_LANCAMENTOS.xlsx")


def clean_str(val):
    if val is None:
        return ""
    return str(val).strip()


def normalize_code(raw_code):
    if not raw_code:
        return None
    normalized = raw_code.replace("-", ".").replace("/", ".")
    parts = []
    for chunk in normalized.split("."):
        digits = re.sub(r"\D", "", chunk or "")
        if not digits:
            continue
        parts.append(digits.zfill(2))
    return ".".join(parts) if parts else None


def generate_plano_de_contas():
    print("\n[1/2] Processando Plano de Contas a partir de PLANCONTAS...")
    wb = openpyxl.load_workbook(BACKUP_PATH, data_only=True)
    ws = wb["PLANCONTAS"]

    plano_rows = []
    seen_codes = set()

    for row_idx, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        c0 = clean_str(r[0])
        tipo_raw = clean_str(r[1])
        if not c0 or c0.lower() in ("xxx", "xx", "classificação", "classificacao"):
            continue

        # Casos especiais sem código na planilha original
        if c0.lower().startswith("saldo positivo"):
            code = "07.03"
            name = "Saldo positivo"
            tipo = "Recebimento"
            parent_code = "07"
            classificacao = "07.03. Saldo positivo"
        elif c0.lower().startswith("saldo negativo"):
            code = "07.04"
            name = "Saldo negativo"
            tipo = "Pagamento"  # ATENÇÃO: PAGAMENTO / DESPESA
            parent_code = "07"
            classificacao = "07.04. Saldo negativo"
        else:
            m = re.match(r"^\s*([0-9][0-9\./-]*)\s*\.?\s*(.*)$", c0)
            if not m:
                continue

            raw_code = m.group(1).rstrip(".")
            raw_name = m.group(2).strip(" .") or c0

            # Normalização de código
            code = normalize_code(raw_code)

            # Correção de anomalias pontuais do arquivo de origem:
            # 1. Grupo 4.5 -> 04.05
            if raw_code in ("4.5", "04.5"):
                code = "04.05"

            # 2. Resolução de códigos duplicados na planilha original:
            if code == "03.15" and "descontos" in raw_name.lower():
                code = "03.16"
            elif code == "04.01.11" and "sindicato" in raw_name.lower():
                code = "04.01.16"
            elif code == "05.04" and "juros" in raw_name.lower():
                code = "05.05"

            # 3. Correção ortográfica e de nomenclatura
            name = raw_name
            if name.lower() == "fonecedores":
                name = "Fornecedores"
            elif "13" in name and "sal" in name.lower():
                name = "Décimo Terceiro Salário (13º)"

            # 4. Determinação de Tipo
            # ATENÇÃO CRÍTICA DO USUÁRIO:
            # Transferência recebida = Recebimento
            # Transferência emitida = Pagamento (NÃO RECEITA!)
            if code.startswith("01") or code.startswith("05") or "recebida" in name.lower() or "positivo" in name.lower():
                tipo = "Recebimento"
            else:
                tipo = "Pagamento"

            # 5. Determinação de Conta Pai
            parts = code.split(".")
            parent_code = ".".join(parts[:-1]) if len(parts) > 1 else ""
            classificacao = f"{code}. {name}"

        if code in seen_codes:
            print(f"  [AVISO] Código duplicado ignorado: {code} ({name})")
            continue
        seen_codes.add(code)

        plano_rows.append({
            "CODIGO": code,
            "NOME": name,
            "TIPO": tipo,
            "CONTA_PAI_CODIGO": parent_code,
            "CLASSIFICACAO": classificacao
        })

    # Assegurar cabeçalho 07 se não tiver vindo completo
    has_07 = any(r["CODIGO"] == "07" for r in plano_rows)
    if not has_07:
        plano_rows.append({
            "CODIGO": "07",
            "NOME": "TRANSFERÊNCIAS E AJUSTES",
            "TIPO": "Pagamento",
            "CONTA_PAI_CODIGO": "",
            "CLASSIFICACAO": "07. TRANSFERÊNCIAS E AJUSTES"
        })

    df_plano = pd.DataFrame(plano_rows)

    # Ordenar hierarquicamente
    df_plano["sort_key"] = df_plano["CODIGO"].apply(lambda x: [int(p) for p in x.split(".")])
    df_plano = df_plano.sort_values(by="sort_key").drop(columns=["sort_key"])

    # Salvar nos dois destinos (FASTESCOVA e arquivo genérico)
    for output_file in [PLANO_FAST_OUTPUT, PLANO_MAIN_OUTPUT]:
        with pd.ExcelWriter(output_file, engine="xlsxwriter") as writer:
            df_plano.to_excel(writer, sheet_name="Plano de Contas", index=False)
            ws_out = writer.sheets["Plano de Contas"]
            wb_out = writer.book

            header_format = wb_out.add_format({
                "bold": True,
                "text_wrap": True,
                "valign": "top",
                "fg_color": "#1E293B",
                "font_color": "#FFFFFF",
                "border": 1
            })

            for col_num, value in enumerate(df_plano.columns.values):
                ws_out.write(0, col_num, value, header_format)

            ws_out.set_column("A:A", 16)  # CODIGO
            ws_out.set_column("B:B", 45)  # NOME
            ws_out.set_column("C:C", 18)  # TIPO
            ws_out.set_column("D:D", 22)  # CONTA_PAI_CODIGO
            ws_out.set_column("E:E", 50)  # CLASSIFICACAO

        print(f"  -> Gerado: {output_file} ({len(df_plano)} categorias)")

    # Exibir resumo das transferências no plano
    print("\n  [VERIFICAÇÃO TRANSFERÊNCIAS NO PLANO DE CONTAS]:")
    transf_check = df_plano[df_plano["CODIGO"].str.startswith("07")]
    for _, r in transf_check.iterrows():
        print(f"    Código {r['CODIGO']:6s} | {r['NOME']:30s} | TIPO: {r['TIPO']}")

    return df_plano


def generate_lancamentos():
    print("\n[2/2] Processando 14.460 Lançamentos da aba Página1...")
    wb = openpyxl.load_workbook(BACKUP_PATH, data_only=True)
    ws = wb["Página1"]

    lanc_rows = []
    skipped_empty = 0

    def parse_date(d):
        if d is None or clean_str(d) == "":
            return None
        if isinstance(d, (datetime.datetime, datetime.date)):
            dt = d.date() if isinstance(d, datetime.datetime) else d
            # Correção do erro de digitação de ano 2003 -> 2025
            if dt.year < 2020:
                dt = dt.replace(year=2025)
            return dt.strftime("%Y-%m-%d")
        ds = clean_str(d)
        if "2003" in ds:
            ds = ds.replace("2003", "2025")
        m = re.match(r"^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})", ds)
        if m:
            p1, p2, p3 = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if p1 >= 1000:
                return f"{p1:04d}-{p2:02d}-{p3:02d}"
            elif p3 >= 1000:
                return f"{p3:04d}-{p2:02d}-{p1:02d}"
        return ds[:10]

    for row_idx, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        # Ignorar linhas totalmente em branco (ex: 401 linhas no final da planilha)
        if not any(c is not None and clean_str(c) != "" for c in r):
            skipped_empty += 1
            continue

        raw_id = r[0]
        raw_vcto = r[1]
        raw_pagto = r[2]
        raw_cat = clean_str(r[3])
        raw_desc = clean_str(r[4])
        raw_entidade = clean_str(r[5])
        raw_val_vcto = r[6]
        raw_val_real = r[7]
        raw_banco = clean_str(r[8])
        raw_centro = clean_str(r[9])
        raw_tipo_col = clean_str(r[12])

        # 1. Datas
        data_vencimento = parse_date(raw_vcto)
        data_pagamento = parse_date(raw_pagto)  # Fica vazio ("") se lançamento estiver em aberto

        # 2. Descrição
        desc = raw_desc
        if not desc:
            if raw_cat:
                desc = f"{raw_cat} - {raw_entidade or 'Sem descrição'}"
            else:
                desc = "Movimento em PIX no PDV"

        # 3. Categoria Normalizada
        # Caso especial: linha 14315 onde categoria veio vazia mas é Pix no PDV
        if not raw_cat and "pix" in desc.lower():
            cat_norm = "01.03. Pix QRS"
        elif raw_cat == "01.05. Pix QRS":
            cat_norm = "01.03. Pix QRS"
        elif raw_cat == "03.12. CLASSIFICAR SAÍDA":
            cat_norm = "03.13. CLASSIFICAR SAÍDA"
        elif raw_cat == "03.01. Fonecedores":
            cat_norm = "03.01. Fornecedores"
        elif raw_cat == "04.01.04. 13º Salário":
            cat_norm = "04.01.04. Décimo Terceiro Salário (13º)"
        elif raw_cat.lower() == "saldo positivo":
            cat_norm = "07.03. Saldo positivo"
        elif raw_cat.lower() == "saldo negativo":
            cat_norm = "07.04. Saldo negativo"
        else:
            cat_norm = raw_cat

        # 4. Determinação de Tipo (RECEITA vs DESPESA)
        # ATENÇÃO CRÍTICA DO USUÁRIO:
        # Transferência recebida = RECEITA
        # Transferência emitida = DESPESA (NÃO RECEITA!)
        # Saldo positivo = RECEITA
        # Saldo negativo = DESPESA (NÃO RECEITA!)
        if (
            cat_norm.startswith("01.") or
            cat_norm.startswith("05.") or
            "transferência recebida" in cat_norm.lower() or
            "saldo positivo" in cat_norm.lower() or
            raw_tipo_col.lower() == "recebimento"
        ):
            # Validação para nunca classificar saída/emitida como receita
            if "transferência emitida" in cat_norm.lower() or "saldo negativo" in cat_norm.lower():
                tipo = "DESPESA"
            else:
                tipo = "RECEITA"
        else:
            tipo = "DESPESA"

        # 5. Valor
        # Se houver valor realizado em lançamento pago, utiliza valor realizado
        try:
            if data_pagamento and raw_val_real is not None and float(raw_val_real) > 0:
                valor = round(float(raw_val_real), 2)
            else:
                valor = round(float(raw_val_vcto or 0.0), 2)
        except (ValueError, TypeError):
            valor = 0.0

        # 6. Conta Bancária
        conta = raw_banco
        if not conta:
            desc_upper = desc.upper()
            if "DINHEIRO" in cat_norm.upper() or "DINHEIRO" in desc_upper:
                conta = "Tesouraria"
            elif "STONE" in desc_upper or "STONE" in raw_entidade.upper():
                conta = "Stone"
            elif "ITAU" in desc_upper or "ITAÚ" in desc_upper or "ITAU" in raw_entidade.upper():
                conta = "Itaú"
            else:
                conta = "Stone"
        elif conta == "Aplicação":
            conta = "Aplicação Itaú"

        # 7. Centro de Custo
        centro = raw_centro or "Ananindeua"

        # 8. Entidade
        entidade = raw_entidade or "DIVERSOS"

        lanc_rows.append({
            "DATA VENCIMENTO": data_vencimento,
            "DATA PAGAMENTO": data_pagamento or "",
            "DESCRIÇÃO": desc,
            "VALOR": valor,
            "TIPO": tipo,
            "CONTA": conta,
            "CATEGORIA": cat_norm,
            "CENTRO DE CUSTO": centro,
            "ENTIDADE": entidade
        })

    df_lanc = pd.DataFrame(lanc_rows)

    # Salvar nos dois destinos
    for output_file in [LANC_FAST_OUTPUT, LANC_MAIN_OUTPUT]:
        with pd.ExcelWriter(output_file, engine="xlsxwriter") as writer:
            df_lanc.to_excel(writer, sheet_name="Lançamentos", index=False)
            ws_out = writer.sheets["Lançamentos"]
            wb_out = writer.book

            header_format = wb_out.add_format({
                "bold": True,
                "text_wrap": True,
                "valign": "top",
                "fg_color": "#0F172A",
                "font_color": "#FFFFFF",
                "border": 1
            })

            date_format = wb_out.add_format({"num_format": "yyyy-mm-dd", "align": "center"})
            currency_format = wb_out.add_format({"num_format": "#,##0.00", "align": "right"})

            for col_num, value in enumerate(df_lanc.columns.values):
                ws_out.write(0, col_num, value, header_format)

            ws_out.set_column("A:A", 18, date_format)      # DATA VENCIMENTO
            ws_out.set_column("B:B", 18, date_format)      # DATA PAGAMENTO
            ws_out.set_column("C:C", 42)                   # DESCRIÇÃO
            ws_out.set_column("D:D", 16, currency_format)  # VALOR
            ws_out.set_column("E:E", 14)                   # TIPO
            ws_out.set_column("F:F", 22)                   # CONTA
            ws_out.set_column("G:G", 42)                   # CATEGORIA
            ws_out.set_column("H:H", 20)                   # CENTRO DE CUSTO
            ws_out.set_column("I:I", 36)                   # ENTIDADE

        print(f"  -> Gerado: {output_file} ({len(df_lanc)} registros, {skipped_empty} vazias ignoradas)")

    # Exibir resumo dos tipos e transferências
    print("\n  [RESUMO POR TIPO]:")
    print(df_lanc["TIPO"].value_counts().to_string())

    print("\n  [VERIFICAÇÃO TRANSFERÊNCIAS E SALDOS]:")
    transf_lanc = df_lanc[df_lanc["CATEGORIA"].str.contains("Transferência|Saldo", case=False, na=False)]
    print(transf_lanc.groupby(["CATEGORIA", "TIPO"]).size().to_string())

    return df_lanc


if __name__ == "__main__":
    df_plano = generate_plano_de_contas()
    df_lanc = generate_lancamentos()
    print("\nProcessamento completo finalizado com sucesso!")

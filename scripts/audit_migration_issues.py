import openpyxl, sys
sys.stdout.reconfigure(encoding='utf-8')
base = r'backups/fabio'

FILES = {
    "Umarizal":     "Base_PizzaFabioUmarizal (1).xlsx",
    "Ananindeua":   "Base_PizzaFabioAnanindeua (3).xlsx",
    "Marco (Base)": "Base_PizzaFabioMarco.xlsx",
    "Marco iFood":  "Base_IFood_PizzaFabioMarco (1).xlsx",
}

CRITICAL_SHEETS = ["Tb_Financeira", "Tb_Movimentacao", "Tb_Ifood", "Tb_Cartoes"]

issues = []

for label, filename in FILES.items():
    wb = openpyxl.load_workbook(base + '/' + filename, read_only=True, data_only=True)
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")

    # --- Tb_Financeira checks ---
    if "Tb_Financeira" in wb.sheetnames:
        ws = wb["Tb_Financeira"]
        rows = list(ws.iter_rows(values_only=True))
        headers = [str(h).strip() if h else '' for h in rows[0]]
        print(f"\n  [Tb_Financeira] {len(rows)-1} linhas | Colunas: {len(headers)}")

        # Check for Centro de Custo (needed for filtering)
        has_cc = "Centro de Custo" in headers
        has_tipo = "Tipo" in headers
        has_banco = "Banco" in headers
        has_sit = "Situação" in headers
        print(f"    Centro de Custo: {'✅' if has_cc else '❌ AUSENTE - filtro por empresa nao funcionara'}")
        print(f"    Tipo:            {'✅' if has_tipo else '❌ AUSENTE - tipo R/D sera inferido incorretamente'}")
        print(f"    Banco:           {'✅' if has_banco else '❌ AUSENTE - nao saberemos qual conta'}")
        print(f"    Situação:        {'✅' if has_sit else '⚠️  ausente'}")

        if not has_cc:
            issues.append(f"[{label}] Tb_Financeira sem 'Centro de Custo' - todos lancamentos serao importados sem filtro de empresa")
        if not has_tipo:
            issues.append(f"[{label}] Tb_Financeira sem 'Tipo' - Receita/Despesa sera inferido errado pelo fallback posicional")

        # Verify if Banco='PDV' entries exist (to confirm our fix matters)
        if has_banco:
            banco_idx = headers.index("Banco")
            pdv_count = sum(1 for r in rows[1:] if r[banco_idx] and str(r[banco_idx]).strip().upper() == 'PDV')
            non_pdv_count = len(rows)-1 - pdv_count
            print(f"    Entradas Banco='PDV': {pdv_count:,} (serao ignoradas)")
            print(f"    Entradas outros bancos: {non_pdv_count:,} (serao importadas)")

        # Check Tipo values
        if has_tipo:
            tipo_idx = headers.index("Tipo")
            tipos = set(str(r[tipo_idx]).strip() for r in rows[1:] if r[tipo_idx])
            print(f"    Valores de Tipo: {tipos}")

    # --- Tb_Movimentacao checks ---
    if "Tb_Movimentacao" in wb.sheetnames:
        ws = wb["Tb_Movimentacao"]
        rows = list(ws.iter_rows(values_only=True))
        headers = [str(h).strip() if h else '' for h in rows[0]]
        has_cc = "Centro de Custo" in headers
        print(f"\n  [Tb_Movimentacao] {len(rows)-1} linhas")
        print(f"    Centro de Custo: {'✅' if has_cc else '❌ AUSENTE'}")
        if not has_cc:
            issues.append(f"[{label}] Tb_Movimentacao sem 'Centro de Custo'")

    # --- Tb_Ifood checks ---
    if "Tb_Ifood" in wb.sheetnames:
        ws = wb["Tb_Ifood"]
        rows = list(ws.iter_rows(values_only=True))
        headers = [str(h).strip() if h else '' for h in rows[0]]
        print(f"\n  [Tb_Ifood] {len(rows)-1} linhas | Colunas: {headers}")
        # Check key columns after fix
        bruto = "Valor" in headers or "Valor Bruto" in headers
        liq = any(h in headers for h in ["Valor Liquido Total", "Valor Líq Ifood", "Valor Líquido"])
        rec = any(h in headers for h in ["Dt Recto Ajustado", "Data Recto", "Data Recebimento"])
        print(f"    Valor Bruto OK:  {'✅' if bruto else '❌'}")
        print(f"    Valor Liquido OK:{'✅' if liq else '❌ sem col liquido, usara bruto'}")
        print(f"    Data Recto OK:   {'✅' if rec else '⚠️  sem data recebimento'}")

        # Check import_hash deduplication
        id_col = "Id_Ifood" in headers
        if not id_col:
            issues.append(f"[{label}] Tb_Ifood sem 'Id_Ifood' - sem chave para deduplicacao")
        else:
            id_idx = headers.index("Id_Ifood")
            ids = [r[id_idx] for r in rows[1:] if r[id_idx]]
            dupes = len(ids) - len(set(str(i) for i in ids))
            if dupes > 0:
                issues.append(f"[{label}] Tb_Ifood tem {dupes} IDs duplicados internamente")
            else:
                print(f"    IDs unicos: ✅ ({len(ids)} IDs, sem duplicatas internas)")

        # Check if iFood deduplication exists in the import (it doesn't!)
        print(f"    ⚠️  AVISO: iFood NAO tem import_hash check -> reimports gerarao duplicatas")
        issues.append(f"[{label}] Tb_Ifood sem import_hash deduplication no script")

    # --- Tb_Cartoes: lancamento_id FK issue ---
    if "Tb_Cartoes" in wb.sheetnames:
        ws = wb["Tb_Cartoes"]
        rows = list(ws.iter_rows(values_only=True))
        print(f"\n  [Tb_Cartoes] {len(rows)-1} linhas")
        print(f"    ❌ CRITICO: LoteCartaoItem.lancamento_id=0 vai falhar FK constraint!")
        issues.append(f"[{label}] LoteCartaoItem.lancamento_id=0 causa violacao de FK - script vai crashar")

    wb.close()

print(f"\n\n{'='*60}")
print("RESUMO DE ISSUES")
print(f"{'='*60}")
for i, issue in enumerate(issues, 1):
    print(f"  {i}. {issue}")

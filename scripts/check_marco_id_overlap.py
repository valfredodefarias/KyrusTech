import openpyxl, sys
sys.stdout.reconfigure(encoding='utf-8')
base = r'backups/fabio'

def get_pdv_ids(path, sheet='Tb_Movimentacao'):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h).strip() if h else '' for h in rows[0]]
    id_idx = headers.index("IdPDV") if "IdPDV" in headers else 0
    cc_idx = headers.index("Centro de Custo") if "Centro de Custo" in headers else None
    ids = set()
    for row in rows[1:]:
        if not any(row): continue
        # Only Marco rows if cc_idx exists
        if cc_idx is not None:
            cc = str(row[cc_idx]).strip() if cc_idx < len(row) and row[cc_idx] else ''
            if cc.lower() != 'marco':
                continue
        val = row[id_idx] if id_idx < len(row) else None
        if val is not None:
            try:
                ids.add(str(int(float(str(val)))))
            except Exception:
                ids.add(str(val).strip())
    wb.close()
    return ids

print("Carregando IDs Marco do Umarizal.xlsx (filtro Centro de Custo=Marco)...")
uma_marco_ids = get_pdv_ids(base + '/Base_PizzaFabioUmarizal (1).xlsx')
print("Total: " + str(len(uma_marco_ids)))

print("Carregando IDs do Marco.xlsx (todos)...")
marco_ids = get_pdv_ids(base + '/Base_PizzaFabioMarco.xlsx')
print("Total: " + str(len(marco_ids)))

overlap = uma_marco_ids & marco_ids
only_uma = uma_marco_ids - marco_ids
only_marco = marco_ids - uma_marco_ids

print()
print("=== RESULTADO ===")
print("IDs em AMBOS (overlap):      " + str(len(overlap)))
print("IDs so no Umarizal (antigos?): " + str(len(only_uma)))
print("IDs so no Marco.xlsx (novos?): " + str(len(only_marco)))
print()
if len(overlap) > 0:
    print("CONCLUSAO: Ha sobreposicao de IDs - os dados do Umarizal e do Marco.xlsx TEM registros em comum.")
    print("Sera necessario limpar o Marco Salao e reimportar do Marco.xlsx.")
elif len(only_uma) > 0 and len(only_marco) > 0:
    print("CONCLUSAO: Sem sobreposicao de IDs - sao datasets completamente diferentes.")
    print("Marco.xlsx tem " + str(len(only_marco)) + " registros novos que nao estao no banco.")

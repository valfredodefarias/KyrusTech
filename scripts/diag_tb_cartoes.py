"""Analisa Tb_Cartoes da planilha e gera SQL INSERT para lotes_cartao."""
import openpyxl
from decimal import Decimal
from collections import defaultdict

wb = openpyxl.load_workbook(
    r'c:\Users\Ciro\Documents\ERP\KyrusERP\scripts\Base_PizzaFabioUmarizal.xlsx',
    data_only=True, read_only=True
)

sheet = wb['Tb_Cartoes']
rows = list(sheet.iter_rows(values_only=True))
headers = [str(h).strip() if h else '' for h in rows[0]]
print('Headers:', headers)

def idx(name, alts=[]):
    for n in [name] + alts:
        if n in headers:
            return headers.index(n)
    return None

dt_venda_i = idx('Data Venda')
forma_i    = idx('Forma Pagto')
band_i     = idx('Bandeira')
val_i      = idx('Valor')
juros_i    = idx('Juros')
liq_i      = idx('Valor Liquido', ['Valor Líquido', 'Valor Liquido'])
dt_recto_i = idx('Data Recto Ajustada', ['DataRecbto', 'Dt Recto Ajustado'])

print('Indices: dt_venda=%s forma=%s band=%s val=%s juros=%s liq=%s dt_recto=%s' % (
    dt_venda_i, forma_i, band_i, val_i, juros_i, liq_i, dt_recto_i))

groups = defaultdict(lambda: {'bruto': Decimal('0'), 'taxa': Decimal('0'), 'liq': Decimal('0'), 'qtd': 0})
skipped = 0
total = 0

for r in rows[1:]:
    if not any(r):
        continue
    total += 1
    try:
        f = str(r[forma_i]).strip() if r[forma_i] else ''
        b = str(r[band_i]).strip() if r[band_i] else ''
        v_raw = r[val_i]
        v = Decimal(str(v_raw)).quantize(Decimal('0.01')) if v_raw else Decimal('0')
        j_raw = r[juros_i]
        j = Decimal(str(j_raw)).quantize(Decimal('0.01')) if j_raw else Decimal('0')
        l_raw = r[liq_i]
        l = Decimal(str(l_raw)).quantize(Decimal('0.01')) if l_raw else (v - j)
        dr_raw = r[dt_recto_i]
        dr = dr_raw.date() if hasattr(dr_raw, 'date') else dr_raw
        dv_raw = r[dt_venda_i]
        dv = dv_raw.date() if hasattr(dv_raw, 'date') else dv_raw
        key = (str(dr or dv), b, f)
        if v <= 0:
            skipped += 1
            continue
        groups[key]['bruto'] += v
        groups[key]['taxa']  += j
        groups[key]['liq']   += l
        groups[key]['qtd']   += 1
    except Exception as e:
        skipped += 1

print()
print('Total linhas planilha:', total)
print('Puladas:', skipped)
print('Total grupos/lotes:', len(groups))
print()

# Amostra
print('=== Primeiros 5 lotes ===')
for i, (k, v) in enumerate(list(groups.items())[:5]):
    dt, band, forma = k
    print('  %s | %s | %s | qtd=%d | bruto=%.2f | taxa=%.2f | liq=%.2f' % (
        dt, band, forma, v['qtd'], v['bruto'], v['taxa'], v['liq']))

# Totais
total_bruto = sum(v['bruto'] for v in groups.values())
total_taxa  = sum(v['taxa']  for v in groups.values())
total_liq   = sum(v['liq']   for v in groups.values())
print()
print('TOTAIS: bruto=%.2f taxa=%.2f liq=%.2f' % (total_bruto, total_taxa, total_liq))

# Gerar SQL INSERT
EMPRESA_ID = 75
CONTA_ID = 412  # Itaú Umarizal

print()
print('=== SQL para inserir lotes_cartao ===')
sqls = []
for (dt, band, forma), v in groups.items():
    bandeira_upper = band.upper().replace('MASTER', 'MASTERCARD')
    sql = (
        "INSERT INTO lotes_cartao (empresa_id, data_pagamento, valor_bruto, valor_taxa, valor_liquido, "
        "conta_destino_id, status, bandeira, forma_pagamento, created_at, updated_at, is_deleted) VALUES "
        "(%d, '%s', %.2f, %.2f, %.2f, %d, 'CONCILIADO', '%s', '%s', NOW(), NOW(), false);"
        % (EMPRESA_ID, dt, v['bruto'], v['taxa'], v['liq'], CONTA_ID, bandeira_upper, forma)
    )
    sqls.append(sql)

# Salvar SQL
sql_path = r'c:\Users\Ciro\Documents\ERP\KyrusERP\scripts\insert_lotes_cartao_umarizal.sql'
with open(sql_path, 'w', encoding='utf-8') as f:
    f.write('-- Lotes de cartao da Umarizal gerados de Tb_Cartoes\n')
    f.write('-- Total: %d lotes\n\n' % len(sqls))
    f.write('\n'.join(sqls))

print('SQL salvo em:', sql_path)
print('Total de INSERTs:', len(sqls))

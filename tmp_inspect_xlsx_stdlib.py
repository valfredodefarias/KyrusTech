import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

p = Path(r"c:\Users\Ciro\Documents\ERP\KyrusERP\xlsx\LinkFinanceiro\classificacao.xlsx")
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
with zipfile.ZipFile(p, 'r') as z:
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('m:si', ns):
            txt = ''.join([(t.text or '') for t in si.findall('.//m:t', ns)])
            shared.append(txt)

    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rel_map = {}
    for rel in rels.findall('{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'):
        rel_map[rel.attrib.get('Id')] = rel.attrib.get('Target')

    sheets = wb.findall('m:sheets/m:sheet', ns)
    print('SHEETS:', [s.attrib.get('name') for s in sheets])
    s = sheets[0]
    rid = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
    target = rel_map.get(rid, '')
    if not target.startswith('xl/'):
        target = 'xl/' + target
    ws = ET.fromstring(z.read(target))
    rows = ws.findall('m:sheetData/m:row', ns)
    print('TOTAL_ROWS:', len(rows))

    for row in rows[:20]:
        values = []
        for c in row.findall('m:c', ns):
            t = c.attrib.get('t')
            v = c.find('m:v', ns)
            is_node = c.find('m:is', ns)
            value = ''
            if t == 's' and v is not None and v.text is not None:
                idx = int(v.text)
                value = shared[idx] if 0 <= idx < len(shared) else ''
            elif t == 'inlineStr' and is_node is not None:
                tnode = is_node.find('.//m:t', ns)
                value = tnode.text if tnode is not None and tnode.text else ''
            elif v is not None and v.text is not None:
                value = v.text
            values.append(value)
        print(values)

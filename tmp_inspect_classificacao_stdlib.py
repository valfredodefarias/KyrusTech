import csv
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

XLSX_PATH = Path(r"c:\Users\Ciro\Documents\ERP\KyrusERP\xlsx\LinkFinanceiro\classificacao.xlsx")
OUT_CSV = Path(r"c:\Users\Ciro\Documents\ERP\KyrusERP\xlsx\LinkFinanceiro\classificacao_preview.csv")

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def col_to_idx(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha()).upper()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def read_xlsx_rows(path: Path):
    with zipfile.ZipFile(path, "r") as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{{{NS_MAIN}}}si"):
                parts = [t.text or "" for t in si.findall(f".//{{{NS_MAIN}}}t")]
                shared.append("".join(parts))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))

        rel_map = {}
        for rel in rels.findall(f"{{{NS_REL}}}Relationship"):
            rel_map[rel.attrib.get("Id")] = rel.attrib.get("Target")

        sheets = wb.findall(f"{{{NS_MAIN}}}sheets/{{{NS_MAIN}}}sheet")
        first = sheets[0]
        rid = first.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = rel_map.get(rid, "")
        if not target.startswith("xl/"):
            target = f"xl/{target}"

        ws = ET.fromstring(z.read(target))
        rows = ws.findall(f"{{{NS_MAIN}}}sheetData/{{{NS_MAIN}}}row")

        for row in rows:
            values_map = {}
            max_col = -1
            for c in row.findall(f"{{{NS_MAIN}}}c"):
                r = c.attrib.get("r", "")
                col_idx = col_to_idx(r)
                max_col = max(max_col, col_idx)
                t = c.attrib.get("t")
                v = c.find(f"{{{NS_MAIN}}}v")
                is_node = c.find(f"{{{NS_MAIN}}}is")
                val = ""
                if t == "s" and v is not None and v.text is not None:
                    idx = int(v.text)
                    val = shared[idx] if 0 <= idx < len(shared) else ""
                elif t == "inlineStr" and is_node is not None:
                    tnode = is_node.find(f".//{{{NS_MAIN}}}t")
                    val = tnode.text if (tnode is not None and tnode.text) else ""
                elif v is not None and v.text is not None:
                    val = v.text
                values_map[col_idx] = val

            if max_col < 0:
                yield []
                continue
            row_values = [values_map.get(i, "") for i in range(max_col + 1)]
            yield row_values


all_rows = list(read_xlsx_rows(XLSX_PATH))
print(f"TOTAL_ROWS={len(all_rows)}")
for idx, row in enumerate(all_rows[:20], start=1):
    print(f"ROW_{idx}={row}")

with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f)
    writer.writerows(all_rows)

print(f"PREVIEW_CSV={OUT_CSV}")

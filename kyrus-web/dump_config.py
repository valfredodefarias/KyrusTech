import re
import os

file_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes_old.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

os.makedirs("c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes", exist_ok=True)
os.makedirs("c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/hooks", exist_ok=True)
os.makedirs("c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/components", exist_ok=True)

logic_lines = []
in_logic = False
return_start = 0

for i, line in enumerate(lines):
    if "export function Configuracoes() {" in line or "export default function Configuracoes() {" in line:
        in_logic = True
        continue
    if in_logic and line.strip().startswith("return (") and ("className=\"flex flex-col" in lines[i+1] or "className=\"flex h-screen" in lines[i+1] or "div" in lines[i+1]):
        return_start = i
        break
    if in_logic:
        logic_lines.append(line)

with open("c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/config_logic_dump.ts", "w", encoding="utf-8") as f:
    f.writelines(logic_lines)

print(f"Dumped config_logic_dump.ts. Lines: {len(logic_lines)}")

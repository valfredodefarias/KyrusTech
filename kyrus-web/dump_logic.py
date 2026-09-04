import re

file_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes_old.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

logic_lines = []
in_logic = False
return_start = 0

for i, line in enumerate(lines):
    if "export function ConciliacaoCartoes() {" in line:
        in_logic = True
        continue
    if in_logic and line.strip().startswith("return (") and "className=\"flex flex-col" in lines[i+1]:
        return_start = i
        break
    if in_logic:
        logic_lines.append(line)

with open("c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/logic_dump.ts", "w", encoding="utf-8") as f:
    f.writelines(logic_lines)

print(f"Dumped logic to logic_dump.ts. Lines: {len(logic_lines)}")

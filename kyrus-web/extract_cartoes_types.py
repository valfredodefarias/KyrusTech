import os

source_file = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes.tsx"
target_dir = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes"
os.makedirs(target_dir, exist_ok=True)

with open(source_file, "r", encoding="utf-8") as f:
    lines = f.readlines()

types_content = ""
for line in lines:
    if line.startswith("export function ConciliacaoCartoes() {"):
        break
    # Skip imports of React, api, icons
    if line.startswith("import React") or line.startswith("import { api") or line.startswith("import { BrandAvatar") or line.startswith("import {"):
        continue
    # Add export to interfaces so they can be imported
    if line.startswith("interface "):
        line = "export " + line
    types_content += line

types_content = types_content.strip()

with open(os.path.join(target_dir, "types.ts"), "w", encoding="utf-8") as f:
    f.write('export const parseSafeDate = (dateStr: string | null | undefined): Date | null => {\n')
    f.write('  if (!dateStr) return null;\n')
    f.write('  if (dateStr.includes("T") || dateStr.includes(" ")) {\n')
    f.write('    const d = new Date(dateStr);\n')
    f.write('    if (!isNaN(d.getTime())) return d;\n')
    f.write('  }\n')
    f.write('  const parts = dateStr.split("-");\n')
    f.write('  if (parts.length === 3) {\n')
    f.write('    const y = parseInt(parts[0], 10);\n')
    f.write('    const m = parseInt(parts[1], 10) - 1;\n')
    f.write('    const d = parseInt(parts[2], 10);\n')
    f.write('    const dateObj = new Date(y, m, d);\n')
    f.write('    if (!isNaN(dateObj.getTime())) return dateObj;\n')
    f.write('  }\n')
    f.write('  const fallback = new Date(dateStr);\n')
    f.write('  return isNaN(fallback.getTime()) ? null : fallback;\n')
    f.write('};\n\n')

    f.write('export const formatSafeDate = (dateStr: string | null | undefined, options?: Intl.DateTimeFormatOptions): string => {\n')
    f.write('  const dObj = parseSafeDate(dateStr);\n')
    f.write('  if (!dObj) return "--/--/----";\n')
    f.write('  try {\n')
    f.write('    return dObj.toLocaleDateString("pt-BR", options);\n')
    f.write('  } catch (e) {\n')
    f.write('    return "--/--/----";\n')
    f.write('  }\n')
    f.write('};\n\n')

    in_interfaces = False
    for line in lines:
        if line.startswith("interface "):
            in_interfaces = True
            f.write("export " + line)
        elif in_interfaces:
            if line.startswith("export function ConciliacaoCartoes"):
                break
            f.write(line)

print("Extracted types to types.ts")

import re

file_path = 'c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes_old.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

# Remove the components we extracted
comps_to_remove = ['DadosEmpresa', 'DadosUsuario', 'IntegracaoNfstockCentroCusto']

# We need to find the start and end of these components accurately.
# We already did this before.
comps = []
pattern = r'(?:const|function|export function) ([A-Z][a-zA-Z0-9_]*)\s*(?:=|=>|\()'
for match in re.finditer(pattern, text):
    comps.append((match.group(1), match.start()))

comps = sorted(list(set(comps)), key=lambda x: x[1])

# Delete from back to front to preserve indices
text_refactored = text
for i in range(len(comps)-1, -1, -1):
    name, start = comps[i]
    if name in comps_to_remove:
        end = comps[i+1][1] if i + 1 < len(comps) else len(text)
        text_refactored = text_refactored[:start] + text_refactored[end:]

# Replace component calls
text_refactored = text_refactored.replace('<DadosEmpresa />', '<TabEmpresa />')
text_refactored = text_refactored.replace('<DadosUsuario />', '<TabUsuarios />')
text_refactored = text_refactored.replace('<IntegracaoNfstockCentroCusto />', '<TabIntegracoes />')

# Add imports at the top
import_block = """
import { TabEmpresa } from './Configuracoes/components/TabEmpresa';
import { TabUsuarios } from './Configuracoes/components/TabUsuarios';
import { TabIntegracoes } from './Configuracoes/components/TabIntegracoes';
"""
import_index = text_refactored.find("import { Entidades } from './Entidades';")
if import_index != -1:
    text_refactored = text_refactored[:import_index] + import_block + text_refactored[import_index:]
else:
    text_refactored = import_block + text_refactored

# Clean up unused constants that were removed
text_refactored = text_refactored.replace("const COMPANY_RESET_PERMISSION = 'empresa:reset_base';", "")
text_refactored = text_refactored.replace("const NFSTOCK_FORCE_SYNC_PERMISSION = 'integracoes:sync';", "")

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes.tsx', 'w', encoding='utf-8') as f:
    f.write(text_refactored)

print("Wrote refactored Configuracoes.tsx")

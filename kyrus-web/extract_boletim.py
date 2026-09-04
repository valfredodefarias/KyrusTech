import re

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim.tsx.bak', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def get_block(start_line, end_pattern):
    block = []
    for i in range(start_line, len(lines)):
        block.append(lines[i])
        if end_pattern in lines[i]:
            return block, i
    return block, len(lines)

for i, line in enumerate(lines):
    if 'export function Boletim' in line:
        start_boletim = i
    if 'return (' in line and i > 2000:
        main_return = i
        break

state_lines = lines[start_boletim:main_return]
jsx_lines = lines[main_return:]

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim/hooks/useBoletim.ts', 'w', encoding='utf-8') as f:
    f.writelines([imp for imp in lines[:start_boletim] if 'import ' in imp and 'Boletim' not in imp])
    f.write('export function useBoletim() {\n')
    f.writelines(state_lines[1:])
    f.write('  return {\n    // TODO: export vars\n  };\n}\n')

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim_UI_Temp.tsx', 'w', encoding='utf-8') as f:
    f.writelines(jsx_lines)

print('Done')

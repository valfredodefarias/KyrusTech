import re

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim.tsx.bak', 'r', encoding='utf-8') as f:
    lines = f.readlines()

hook_lines = lines[564:2188]
vars_to_export = []

for line in hook_lines:
    m = re.match(r'\s*const \[(\w+), (\w+)\] =', line)
    if m:
        vars_to_export.extend([m.group(1), m.group(2)])
    m2 = re.match(r'\s*const (\w+) = (useMemo|useCallback|useRef|useTransactionStore|useLookupStore|useAuthStore|useIsDarkMode|useNavigate)\(', line)
    if m2:
        vars_to_export.append(m2.group(1))
    m3 = re.match(r'\s*const (\w+)\s*:', line)
    if m3 and m3.group(1) not in ['emptyRows', 'donutColors', 'monthlySeries']:
        vars_to_export.append(m3.group(1))
    m4 = re.match(r'\s*const (\w+) = ', line)
    if m4 and '(' not in m4.group(0):
        vars_to_export.append(m4.group(1))
    elif m4 and '=>' in line:
        vars_to_export.append(m4.group(1))

vars_to_export = list(dict.fromkeys(vars_to_export))
false_positives = ['BRL', 'MONTH_NAMES', 'initial', 'active', 'response', 'serverDate', 'hasCachedTransactions', 'hasCachedLookups', 'shouldShowLoader']
exported = [v for v in vars_to_export if v not in false_positives]

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim.tsx', 'w', encoding='utf-8') as b:
    b.write("import React from 'react';\n")
    b.write("import { useBoletim } from './Boletim/hooks/useBoletim';\n\n")
    with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim.tsx.bak', 'r', encoding='utf-8') as bak:
        bak_lines = bak.readlines()
        for l in bak_lines[:563]:
            if 'import ' in l:
                b.write(l)
    
    b.write('\nexport function Boletim() {\n')
    b.write('  const {\n')
    for chunk in [exported[i:i+8] for i in range(0, len(exported), 8)]:
        b.write('    ' + ', '.join(chunk) + ',\n')
    b.write('  } = useBoletim();\n\n')
    
    b.write('''
if (loading && !initialLoadDoneRef.current) {
return (
  <div className={`p-8 space-y-6 ${isDark ? 'bg-[#0d1117] text-white' : 'bg-slate-50'}`}>
    {/* Skeleton Header */}
    <div className="flex items-center gap-4 animate-pulse">
      <div className="w-16 h-16 rounded-lg bg-slate-300 dark:bg-slate-700" />
      <div className="space-y-2">
        <div className="w-48 h-6 rounded bg-slate-300 dark:bg-slate-700" />
        <div className="w-32 h-4 rounded bg-slate-300 dark:bg-slate-700" />
      </div>
    </div>
    {/* Skeleton Grid */}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="h-28 rounded-xl bg-slate-300 dark:bg-slate-700 p-4 space-y-3">
          <div className="w-20 h-4 rounded bg-slate-200 dark:bg-slate-600" />
          <div className="w-32 h-8 rounded bg-slate-200 dark:bg-slate-600" />
        </div>
      ))}
    </div>
    {/* Skeleton Main Chart */}
    <div className="h-96 rounded-xl bg-slate-300 dark:bg-slate-700 animate-pulse flex items-center justify-center">
      <div className="text-slate-400 dark:text-slate-500 font-bold">Carregando dados financeiros...</div>
    </div>
  </div>
);
}
''')
    with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Boletim_UI_Temp.tsx', 'r', encoding='utf-8') as ui:
        b.write(ui.read())
        
print('Generated Boletim.tsx!')

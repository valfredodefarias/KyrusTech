import re

with open('c:\\Users\\Ciro\\Documents\\ERP\\KyrusERP\\kyrus-web\\src\\pages\\MovimentacaoPDV.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Insert formatExpressionCentsFirst
format_fn = '''function formatExpressionCentsFirst(input: string): string {
  if (!input) return '';
  const tokens = input.split(/([+\\-*/()])/g);
  const formattedTokens = tokens.map((token) => {
    if (/^[0-9]+$/.test(token)) {
      const padded = token.padStart(3, '0');
      const integerPart = padded.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
      const decimalPart = padded.slice(-2);
      return \\,\\;
    }
    return token;
  });
  return formattedTokens.join('');
}

export function MovimentacaoPDV() {'''

content = content.replace('export function MovimentacaoPDV() {', format_fn)

# 2. states
content = content.replace(
    "const [formValor, setFormValor] = useState('');",
    "const [formValor, setFormValor] = useState('');\n  const [formValorText, setFormValorText] = useState('');"
)
content = content.replace(
    "const [sangriaValor, setSangriaValor] = useState('');",
    "const [sangriaValor, setSangriaValor] = useState('');\n  const [sangriaValorText, setSangriaValorText] = useState('');"
)

# 3. blurs
blurs = '''
  const handleFormValorBlur = () => {
    if (!formValorText) {
      setFormValor('');
      return;
    }
    const cleanExpr = formValorText.replace(/\\./g, '').replace(/,/g, '.');
    if (/^[0-9+\\-*/().\\s]+$/.test(cleanExpr)) {
      try {
        const result = Function("use strict"; return ())();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setFormValorText(formatted);
          setFormValor(String(result.toFixed(2)));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const handleSangriaValorBlur = () => {
    if (!sangriaValorText) {
      setSangriaValor('');
      return;
    }
    const cleanExpr = sangriaValorText.replace(/\\./g, '').replace(/,/g, '.');
    if (/^[0-9+\\-*/().\\s]+$/.test(cleanExpr)) {
      try {
        const result = Function("use strict"; return ())();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setSangriaValorText(formatted);
          setSangriaValor(String(result.toFixed(2)));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const handleOpenDrawer = (tipo: 'ENTRADA' | 'SAIDA', editItem?: MovimentacaoPDV) => {'''

content = content.replace("const handleOpenDrawer = (tipo: 'ENTRADA' | 'SAIDA', editItem?: MovimentacaoPDV) => {", blurs)

# 4. handleOpenDrawer setFormValorText
content = content.replace(
    "setFormValor(String(editItem.valor));\n        setFormFormaPagamento(editItem.forma_pagamento);",
    "setFormValor(String(editItem.valor));\n        setFormValorText(Number(editItem.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));\n        setFormFormaPagamento(editItem.forma_pagamento);"
)
content = content.replace(
    "setFormValor('');\n        setFormFormaPagamento('DINHEIRO');",
    "setFormValor('');\n        setFormValorText('');\n        setFormFormaPagamento('DINHEIRO');"
)

# 5. handleOpenSangriaDrawer
content = content.replace(
    "setSangriaValor(availableCash > 0 ? String(availableCash) : '');\n      setSangriaData(selectedDate || new Date().toISOString().split('T')[0]);",
    "setSangriaValor(availableCash > 0 ? String(availableCash) : '');\n      setSangriaValorText(availableCash > 0 ? Number(availableCash).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');\n      setSangriaData(selectedDate || new Date().toISOString().split('T')[0]);"
)

# 6. input formValor
content = content.replace(
    '''<input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formValor}
                    onChange={(e) => setFormValor(e.target.value)}
                    className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono font-bold"
                    required
                  />''',
    '''<input
                    type="text"
                    placeholder="0,00 ou 10+5"
                    value={formValorText}
                    onChange={(e) => {
                      const cleanExpr = e.target.value.replace(/\\./g, '').replace(/,/g, '');
                      setFormValorText(formatExpressionCentsFirst(cleanExpr));
                    }}
                    onBlur={handleFormValorBlur}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleFormValorBlur(); }}
                    className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono font-bold"
                    required
                  />'''
)

# 7. input sangriaValor
content = content.replace(
    '''<input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0,00"
                    disabled={saving}
                    value={sangriaValor}
                    onChange={(e) => setSangriaValor(e.target.value)}
                    className="w-full pl-9 pr-4 py-3 rounded-none border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:border-rose-500 transition disabled:opacity-50 font-mono"
                  />''',
    '''<input
                    type="text"
                    required
                    placeholder="0,00 ou 10+5"
                    disabled={saving}
                    value={sangriaValorText}
                    onChange={(e) => {
                      const cleanExpr = e.target.value.replace(/\\./g, '').replace(/,/g, '');
                      setSangriaValorText(formatExpressionCentsFirst(cleanExpr));
                    }}
                    onBlur={handleSangriaValorBlur}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSangriaValorBlur(); }}
                    className="w-full pl-9 pr-4 py-3 rounded-none border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:border-rose-500 transition disabled:opacity-50 font-mono"
                  />'''
)

with open('c:\\Users\\Ciro\\Documents\\ERP\\KyrusERP\\kyrus-web\\src\\pages\\MovimentacaoPDV.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully.")

import re

file_path = 'c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/dump_DadosEmpresa.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

return_match = re.search(r'  return \(', text)
ui_text = text[return_match.start():] if return_match else ''

imports = """import React from 'react';
import { Camera, Check, AlertCircle, Layers, Palette, Save, Loader2, Trash2 } from 'lucide-react';
import { useEmpresa } from '../hooks/useEmpresa';

export const TabEmpresa = () => {
  const {
    empresa, user, loading, saving, resetting, cor, setCor, previewUrl,
    categoriasDespesaNfe, categoriaNfeFornecedoresId, setCategoriaNfeFornecedoresId, loadingCategoriasNfe,
    canResetEmpresa, handleLogoChange, handleSave, handleResetEmpresa
  } = useEmpresa();

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8"/></div>;
  if (!empresa) return <div className="p-10 text-center text-slate-500">Empresa não encontrada.</div>;
"""

out_path = 'c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/components/TabEmpresa.tsx'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(imports + '\n' + ui_text)
print('Wrote TabEmpresa.tsx')

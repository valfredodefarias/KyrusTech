import React, { useState, useEffect } from 'react';
import { X, Loader2, UploadCloud, ArrowRight, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { api, normalizeListResponse } from '../../../services/api';
import { toast } from 'sonner';
import { SearchableSelect } from '../../../components/SearchableSelect';
import { CurrencyInput } from '../../../components/CurrencyInput';

interface CategoriaItem { id: number; nome: string; }

interface ImportacaoXlsxCartaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartaoId: number;
  competenciaFaturaAtual: string;
  onSuccess: () => void;
}

export function ImportacaoXlsxCartaoModal({
  isOpen,
  onClose,
  cartaoId,
  competenciaFaturaAtual,
  onSuccess
}: ImportacaoXlsxCartaoModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[]>([]);
  
  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  
  // Mapping
  const [colData, setColData] = useState<string>('');
  const [colDesc, setColDesc] = useState<string>('');
  const [colValor, setColValor] = useState<string>('');
  
  // Processed Rows
  const [processedRows, setProcessedRows] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && categorias.length === 0) {
      api.get('/plano-contas/').then(res => {
        setCategorias(normalizeListResponse(res.data).filter((c: any) => c.tipo === 'DESPESA' && c.permite_lancamentos !== false) as CategoriaItem[]);
      });
    }
  }, [isOpen]);

  const handleFileUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/cartoes/upload-xlsx', formData);
      setColumns(res.data.columns || []);
      setRawRows(res.data.rows || []);
      setStep(2);
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Erro ao processar planilha.');
    } finally {
      setUploading(false);
    }
  };

  const handleMapping = () => {
    if (!colData || !colDesc || !colValor) {
      toast.error('Mapeie todas as colunas obrigatórias.');
      return;
    }
    
    const rows = rawRows.map((r, i) => {
      // Tentar converter valor para number
      let val = r[colValor];
      if (typeof val === 'string') {
        val = Number(val.replace(/[^0-9,-]/g, '').replace(',', '.'));
      }
      
      // Tentar converter data
      let dateVal = r[colData];
      if (dateVal && dateVal.includes('/')) {
        // Formato BR (dd/mm/yyyy)
        const parts = dateVal.split('/');
        if (parts.length === 3) dateVal = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      
      return {
        id_temp: i,
        data_compra: dateVal || new Date().toISOString().split('T')[0],
        descricao: String(r[colDesc] || ''),
        valor: Math.abs(Number(val) || 0),
        plano_contas_id: ''
      };
    }).filter(r => r.descricao && r.valor > 0);
    
    setProcessedRows(rows);
    setStep(3);
  };

  const handleBulkSave = async () => {
    const invalid = processedRows.find(r => !r.plano_contas_id);
    if (invalid) {
      toast.error('Por favor, selecione a categoria para todas as despesas.');
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        lancamentos: processedRows.map(r => ({
          descricao: r.descricao,
          valor: r.valor,
          data_compra: r.data_compra,
          plano_contas_id: Number(r.plano_contas_id),
          quantidade_parcelas: 1,
          competencia_fatura_inicial: competenciaFaturaAtual
        }))
      };
      
      await api.post(`/cartoes/${cartaoId}/lancamentos/bulk`, payload);
      toast.success('Lançamentos importados com sucesso!');
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Erro ao importar.');
    } finally {
      setSaving(false);
    }
  };

  const removeRow = (id_temp: number) => {
    setProcessedRows(prev => prev.filter(r => r.id_temp !== id_temp));
  };
  
  const updateRow = (id_temp: number, field: string, value: any) => {
    setProcessedRows(prev => prev.map(r => r.id_temp === id_temp ? { ...r, [field]: value } : r));
  };

  const setAllCategories = (cat_id: string) => {
    setProcessedRows(prev => prev.map(r => ({ ...r, plano_contas_id: cat_id })));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[9998] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <CheckCircle2 className="text-green-500" /> Importação de Fatura XLSX
            </h2>
            <p className="text-sm text-slate-500">Mapeie sua planilha para importar os gastos para a fatura <b>{competenciaFaturaAtual}</b>.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-400">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
              <UploadCloud size={48} className="text-slate-400" />
              <div className="text-center">
                <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Selecione o arquivo Excel da Fatura</p>
                <p className="text-sm text-slate-500">Suporta arquivos .xlsx e .xls</p>
              </div>
              <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
              
              <button 
                onClick={handleFileUpload} 
                disabled={!file || uploading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {uploading && <Loader2 size={16} className="animate-spin" />} Continuar
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                Identificamos as colunas da sua planilha. Selecione qual coluna corresponde a cada campo abaixo.
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Coluna de Data</label>
                  <select value={colData} onChange={e => setColData(e.target.value)} className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white">
                    <option value="">Selecione...</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Coluna de Descrição</label>
                  <select value={colDesc} onChange={e => setColDesc(e.target.value)} className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white">
                    <option value="">Selecione...</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Coluna de Valor</label>
                  <select value={colValor} onChange={e => setColValor(e.target.value)} className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white">
                    <option value="">Selecione...</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex justify-end mt-4">
                <button onClick={handleMapping} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2">
                  Pré-visualizar <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-slate-600 dark:text-slate-300">Revisão dos lançamentos. Categorize-os antes de salvar.</p>
                <div className="w-72">
                  <SearchableSelect 
                    options={[{ label: 'Categorias', options: categorias.map(c => ({ id: c.id, label: c.nome })) }]}
                    placeholder="Aplicar categoria em todos..."
                    value="" onChange={v => { if(v) setAllCategories(String(v)); }}
                  />
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Descrição</th>
                      <th className="px-4 py-3">Categoria</th>
                      <th className="px-4 py-3 text-right">Valor</th>
                      <th className="px-4 py-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {processedRows.map(row => (
                      <tr key={row.id_temp} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2">
                          <input type="date" value={row.data_compra} onChange={e => updateRow(row.id_temp, 'data_compra', e.target.value)} className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-sm dark:text-white" />
                        </td>
                        <td className="px-4 py-2">
                          <input type="text" value={row.descricao} onChange={e => updateRow(row.id_temp, 'descricao', e.target.value)} className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1 w-full text-sm dark:text-white" />
                        </td>
                        <td className="px-4 py-2 min-w-[200px]">
                          <SearchableSelect 
                            options={[{ label: 'Categorias', options: categorias.map(c => ({ id: c.id, label: c.nome })) }]}
                            value={row.plano_contas_id}
                            onChange={v => updateRow(row.id_temp, 'plano_contas_id', String(v))}
                            placeholder="Selecione..."
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <CurrencyInput value={String(row.valor)} onValueChange={v => updateRow(row.id_temp, 'valor', Number(v))} className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-sm text-right w-24 dark:text-white" />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => removeRow(row.id_temp)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{processedRows.length} lançamentos processados.</span>
                <button onClick={handleBulkSave} disabled={saving} className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Importar Lançamentos
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { api, normalizeListResponse } from '../../../services/api';
import { toast } from 'sonner';
import { CurrencyInput } from '../../../components/CurrencyInput';
import { SearchableSelect } from '../../../components/SearchableSelect';

function formatExpressionCentsFirst(input: string): string {
  if (!input) return '';
  const tokens = input.split(/([+\-*/()])/g);
  const formattedTokens = tokens.map((token) => {
    const digits = token.replace(/\D/g, '');
    if (digits.length > 0) {
      const num = parseFloat(digits) / 100;
      return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return token;
  });
  return formattedTokens.join('');
}

interface CategoriaItem { id: number; nome: string; tipo: string; eh_cabecalho: boolean; permite_lancamentos: boolean; }
interface CentroCustoItem { id: number; nome: string; }
interface EntidadeItem { id: number; nome: string; }

interface LancamentoCartaoFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  lancamentoId: number | null;
  cartaoId: number;
  competenciaFaturaAtual: string; // Ex: "2026-09"
  cartaoCentroCustoId?: number | null;
  onSaveSuccess: () => void;
}

export function LancamentoCartaoFormDrawer({
  isOpen,
  onClose,
  lancamentoId,
  cartaoId,
  competenciaFaturaAtual,
  cartaoCentroCustoId,
  onSaveSuccess
}: LancamentoCartaoFormDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [amountText, setAmountText] = useState('');

  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoItem[]>([]);
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);

    const [formData, setFormData] = useState({
        descricao: '',
        valor: '',
        data_compra: new Date().toISOString().split('T')[0],
        plano_contas_id: '',
        centro_custo_id: cartaoCentroCustoId ? String(cartaoCentroCustoId) : '',
        entidade_id: '',
        observacao: '',
        quantidade_parcelas: '1',
        tipo_valor: 'TOTAL',
        regime_competencia: 'COMPRA'
    });

  useEffect(() => {
    if (isOpen) {
      loadDependencies();
      if (lancamentoId) {
        loadLancamento(lancamentoId);
      } else {
        setFormData({
          descricao: '',
          valor: '',
          data_compra: new Date().toISOString().split('T')[0],
          plano_contas_id: '',
          centro_custo_id: cartaoCentroCustoId ? String(cartaoCentroCustoId) : '',
          entidade_id: '',
          observacao: '',
          quantidade_parcelas: '1',
          tipo_valor: 'TOTAL',
          regime_competencia: 'COMPRA'
        });
        setAmountText('');
      }
    }
  }, [isOpen, lancamentoId]);

  const loadDependencies = async () => {
    if (categorias.length > 0) return;
    try {
      const [catRes, ccRes, entRes] = await Promise.all([
        api.get('/plano-contas/'),
        api.get('/centro-custo/'),
        api.get('/entidades/')
      ]);
      setCategorias(normalizeListResponse(catRes.data).filter((c: any) => (c.tipo === 'DESPESA' || c.tipo === 'D') && c.permite_lancamentos !== false) as CategoriaItem[]);
      setCentrosCusto(normalizeListResponse(ccRes.data));
      setEntidades(normalizeListResponse(entRes.data));
    } catch (e) {
      console.error(e);
      toast.error('Erro ao carregar categorias.');
    }
  };

  const loadLancamento = async (id: number) => {
    setInitialLoading(true);
    try {
      // Como não temos um GET /lancamentos/{id} direto pro cartão, pegamos os dados e filtramos 
      // ou criamos um endpoint. O ideal é ter o objeto passado ou buscar.
      // Vou buscar todos do cartao para simplificar, ou fazer um endpoint.
      const res = await api.get(`/cartoes/${cartaoId}/lancamentos`);
      const list = normalizeListResponse<any>(res.data);
      const lanc = list.find((item) => item.id === id);
      
      if (lanc) {
        setFormData({
          descricao: lanc.descricao || '',
          valor: String(lanc.valor || ''),
          data_compra: (lanc.data_compra || '').split('T')[0],
          plano_contas_id: String(lanc.plano_contas_id || ''),
          centro_custo_id: String(lanc.centro_custo_id || ''),
          entidade_id: String(lanc.entidade_id || ''),
          observacao: lanc.observacao || '',
          quantidade_parcelas: '1', // Em edição, não parcelamos novamente
          tipo_valor: 'TOTAL',
          regime_competencia: 'COMPRA'
        });
        const num = Number(lanc.valor);
        if (Number.isFinite(num) && num > 0) {
          setAmountText(num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        } else {
          setAmountText(String(lanc.valor || ''));
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Erro ao carregar despesa.');
    } finally {
      setInitialLoading(false);
    }
  };

  const handleAmountBlur = () => {
    if (!amountText) {
      setFormData(prev => ({ ...prev, valor: '' }));
      return;
    }
    const cleanExpr = amountText.replace(/\./g, '').replace(/,/g, '.');
    if (/^[0-9+\-*/().\s]+$/.test(cleanExpr)) {
      try {
        const result = Function(`"use strict"; return (${cleanExpr})`)();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setAmountText(formatted);
          setFormData(prev => ({ ...prev, valor: String(result.toFixed(2)) }));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const handleSave = async () => {
    if (!formData.descricao || !formData.valor || !formData.plano_contas_id || !formData.data_compra) {
      toast.error('Preencha os campos obrigatórios.');
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        ...formData,
        valor: Number(formData.valor),
        quantidade_parcelas: Number(formData.quantidade_parcelas) || 1,
        plano_contas_id: Number(formData.plano_contas_id),
        centro_custo_id: formData.centro_custo_id ? Number(formData.centro_custo_id) : null,
        entidade_id: formData.entidade_id ? Number(formData.entidade_id) : null,
      };

      if (lancamentoId) {
        await api.put(`/cartoes/lancamentos/${lancamentoId}`, payload);
        toast.success('Despesa atualizada!');
      } else {
        // Se for novo, vamos dizer ao backend que queremos forçar a começar nesta fatura
        (payload as any).competencia_fatura_inicial = competenciaFaturaAtual;
        await api.post(`/cartoes/${cartaoId}/lancamentos`, payload);
        toast.success('Despesa lançada com sucesso!');
      }
      onSaveSuccess();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.detail || 'Erro ao salvar despesa.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[9998] transition-opacity backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[450px] bg-slate-50 dark:bg-slate-900 z-[9999] shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 transform transition-transform duration-300">
        
        {/* HEADER */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
              {lancamentoId ? 'Editar Despesa' : 'Nova Despesa no Cartão'}
            </h2>
            <p className="text-sm text-slate-500">
              {lancamentoId ? 'Ajuste os dados da compra.' : `Fatura: ${competenciaFaturaAtual}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {initialLoading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Descrição</label>
                <input
                  type="text"
                  value={formData.descricao}
                  onChange={e => setFormData({...formData, descricao: e.target.value})}
                  className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ex: Uber, Mercado, etc."
                />
              </div>
              
              <div className="flex gap-4">
                <div className="flex-1 w-full">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Valor</label>
                  <input
                    type="text"
                    value={amountText}
                    onChange={(e) => {
                      const rawVal = e.target.value;
                      const cleanExpr = rawVal.replace(/\./g, '').replace(/,/g, '');
                      const formatted = formatExpressionCentsFirst(cleanExpr);
                      setAmountText(formatted);
                    }}
                    onBlur={handleAmountBlur}
                    placeholder="0,00 ou 150+300"
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-bold text-lg text-blue-500 dark:text-blue-400"
                  />
                  {Number(formData.quantidade_parcelas) > 1 && formData.tipo_valor === 'TOTAL' && Number(formData.valor) > 0 && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Serão {formData.quantidade_parcelas} parcelas de{' '}
                      <strong>
                        {(Number(formData.valor) / Number(formData.quantidade_parcelas)).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </strong>
                    </p>
                  )}
                  {Number(formData.quantidade_parcelas) > 1 && formData.tipo_valor === 'PARCELA' && Number(formData.valor) > 0 && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Total: {' '}
                      <strong>
                        {(Number(formData.valor) * Number(formData.quantidade_parcelas)).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </strong>
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Data da Compra</label>
                  <input
                    type="date"
                    value={formData.data_compra}
                    onChange={e => setFormData({...formData, data_compra: e.target.value})}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              {!lancamentoId && (
                <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Qtd. de Parcelas</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.quantidade_parcelas}
                      onChange={e => setFormData({...formData, quantidade_parcelas: e.target.value})}
                      className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  
                  {Number(formData.quantidade_parcelas) > 1 && (
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cálculo</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData({...formData, tipo_valor: 'TOTAL'})}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${formData.tipo_valor === 'TOTAL' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Total
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData({...formData, tipo_valor: 'PARCELA'})}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${formData.tipo_valor === 'PARCELA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Por parcela
                        </button>
                      </div>
                    </div>
                  )}

                  {Number(formData.quantidade_parcelas) > 1 && (
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Competência das Parcelas</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData({...formData, regime_competencia: 'PARCELA'})}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${formData.regime_competencia === 'PARCELA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Por parcela
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData({...formData, regime_competencia: 'COMPRA'})}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${formData.regime_competencia === 'COMPRA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Mês da compra
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400 leading-tight">
                        Por parcela: cada parcela entra no mês correspondente. Mês da compra: todas as parcelas ficam na competência da compra.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Categoria</label>
                <SearchableSelect
                  options={[{ label: 'Categorias', options: categorias.map(c => ({ id: c.id, label: c.nome })) }]}
                  value={formData.plano_contas_id}
                  onChange={v => setFormData({...formData, plano_contas_id: String(v)})}
                  placeholder="Selecione..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Interessado (Opcional)</label>
                <SearchableSelect
                  options={[{ label: 'Entidades', options: entidades.map(c => ({ id: c.id, label: c.nome })) }]}
                  value={formData.entidade_id}
                  onChange={v => setFormData({...formData, entidade_id: String(v)})}
                  placeholder="Buscar interessado..."
                  
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Centro de Custo (Opcional)</label>
                <SearchableSelect
                  options={[{ label: 'Centros de Custo', options: centrosCusto.map(c => ({ id: c.id, label: c.nome })) }]}
                  value={formData.centro_custo_id}
                  onChange={v => setFormData({...formData, centro_custo_id: String(v)})}
                  placeholder="Selecione..."
                  
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Observações (Opcional)</label>
                <textarea
                  value={formData.observacao}
                  onChange={e => setFormData({...formData, observacao: e.target.value})}
                  className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  rows={3}
                />
              </div>
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 flex justify-end gap-3 sticky bottom-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || initialLoading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            Salvar
          </button>
        </div>
        
      </div>
    </>
  );
}

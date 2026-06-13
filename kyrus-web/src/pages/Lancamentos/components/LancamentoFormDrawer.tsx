import { useMemo, useRef } from 'react';
import {
  X,
  Copy,
  LayoutGrid,
  Plus,
  Trash2,
  Download,
  UploadCloud,
  Loader2,
  Check,
  Wallet,
  CreditCard,
  Image as ImageIcon,
  FileSpreadsheet,
  Presentation,
  FileText,
} from 'lucide-react';
import { SearchableSelect } from '../../../components/SearchableSelect';
import { BankAvatar } from '../../../components/BrandAvatar';
import { toPublicAssetUrl } from '../../../services/api';
import { InputDark, CurrencyInputDark, ToggleSimNao } from './InputDark';
import type { Lancamento, Anexo } from '../types';
import {
  computeCartaoVencimento,
  parseDescricaoParcela,
  resolveAnexoUrl,
} from '../utils';

interface LancamentoFormDrawerProps {
  showDrawer: boolean;
  isBoletimEmbed: boolean;
  embedFullscreenDrawer: boolean;
  drawerPanelClassName?: string;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
  saving: boolean;
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  filesToUpload: FileList | null;
  setFilesToUpload: (files: FileList | null) => void;
  hasUnsavedDrawerChanges: boolean;
  parcelasSerie: Lancamento[];
  parcelasSerieLoading: boolean;
  parcelasVencimentosEdit: Record<number, string>;
  setParcelasVencimentosEdit: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  ajustarParaDiaUtil: boolean;
  setAjustarParaDiaUtil: (val: boolean) => void;
  showParcelasSeriePanel: boolean;
  categorias: any[];
  entidades: any[];
  contas: any[];
  cartoes: any[];
  centros: any[];
  lancamentos: Lancamento[];
  openEntityDrawer: () => void;
  requestCloseDrawer: () => void;
  handleSave: (e?: React.FormEvent) => void;
  handleVerTodasParcelas: () => void;
  handleSelecionarParcelaSerie: (item: Lancamento) => void;
  handleRemoverAnexo: (anexo: Anexo) => void;
  pushToast: (type: 'success' | 'error' | 'info', message: string) => void;
  toggleConta: (id: number) => void;
  toggleCartao: (id: number) => void;
  handleVencimentoChange: (value: string) => void;
  handleCompetenciaChange: (value: string) => void;
  handleStatusPagoChange: (checked: boolean) => void;
  handleValorPrevistoChange: (value: string) => void;
  handleValorPagoChange: (value: string) => void;
  handleDataPagamentoChange: (value: string) => void;
  isCaixaMode?: boolean;
}

export const LancamentoFormDrawer = ({
  showDrawer,
  isBoletimEmbed,
  embedFullscreenDrawer,
  drawerPanelClassName,
  isEditing,
  setIsEditing,
  saving,
  formData,
  setFormData,
  filesToUpload,
  setFilesToUpload,
  hasUnsavedDrawerChanges,
  parcelasSerie,
  parcelasSerieLoading,
  parcelasVencimentosEdit,
  setParcelasVencimentosEdit,
  ajustarParaDiaUtil,
  setAjustarParaDiaUtil,
  showParcelasSeriePanel,
  categorias,
  entidades,
  contas,
  cartoes,
  centros,
  lancamentos,
  openEntityDrawer,
  requestCloseDrawer,
  handleSave,
  handleVerTodasParcelas,
  handleSelecionarParcelaSerie,
  handleRemoverAnexo,
  pushToast,
  toggleConta,
  toggleCartao,
  handleVencimentoChange,
  handleCompetenciaChange,
  handleStatusPagoChange,
  handleValorPrevistoChange,
  handleValorPagoChange,
  handleDataPagamentoChange,
  isCaixaMode = false,
}: LancamentoFormDrawerProps) => {
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const pagamentoSectionRef = useRef<HTMLDivElement | null>(null);

  const getFullLogoUrl = (url?: string | null) => toPublicAssetUrl(url);

  const sortedParcelasSerie = useMemo(() => {
    return [...parcelasSerie].sort((a, b) => {
      const parcelaA = Number(a.numero_parcela || 0);
      const parcelaB = Number(b.numero_parcela || 0);
      if (parcelaA !== parcelaB) return parcelaA - parcelaB;
      return String(a.data_vencimento || '').localeCompare(String(b.data_vencimento || ''));
    });
  }, [parcelasSerie]);

  const currentParcelaNumber = useMemo(() => {
    if (formData?.numero_parcela) return Number(formData.numero_parcela);
    const parsed = parseDescricaoParcela(formData?.descricao);
    if (parsed?.numero) return parsed.numero;
    const idx = sortedParcelasSerie.findIndex((p) => Number(p.id) === Number(formData?.id));
    return idx >= 0 ? idx + 1 : 1;
  }, [formData?.id, formData?.numero_parcela, formData?.descricao, sortedParcelasSerie]);

  const currentParcelaTotal = useMemo(() => {
    if (sortedParcelasSerie.length > 1) return sortedParcelasSerie.length;
    const parsed = parseDescricaoParcela(formData?.descricao);
    if (parsed?.total && parsed.total > 1) return parsed.total;
    if (formData?.qtd_parcelas && Number(formData.qtd_parcelas) > 1) return Number(formData.qtd_parcelas);
    return 1;
  }, [sortedParcelasSerie.length, formData?.descricao, formData?.qtd_parcelas]);

  const isEditingParcelado = useMemo(() => {
    if (!isEditing) return false;
    if (Boolean(formData?.id_parcelamento)) return currentParcelaTotal > 1;
    if (Number(formData?.numero_parcela || 0) > 0 && currentParcelaTotal > 1) return true;
    return Boolean(parseDescricaoParcela(formData?.descricao));
  }, [isEditing, formData?.id_parcelamento, formData?.numero_parcela, formData?.descricao, currentParcelaTotal]);

  const canOpenParcelasSerie = useMemo(() => {
    if (!isEditing) return false;
    if (Boolean(formData?.id_parcelamento)) return true;
    if (Number(formData?.numero_parcela || 0) > 0) return true;
    return Boolean(parseDescricaoParcela(formData?.descricao));
  }, [isEditing, formData?.id_parcelamento, formData?.numero_parcela, formData?.descricao]);

  const shouldShowParcelasSerie = !isBoletimEmbed && (isEditingParcelado || showParcelasSeriePanel);

  const getFileIcon = (nome: string) => {
    const ext = nome.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(ext || '')) return <ImageIcon className="w-4 h-4 text-purple-400" />;
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    if (['ppt', 'pptx'].includes(ext || '')) return <Presentation className="w-4 h-4 text-orange-400" />;
    return <FileText className="w-4 h-4 text-blue-400" />;
  };

  const catOptions = useMemo(() => [
    {
      label: 'SAIDAS',
      options: categorias
        .filter((c) => (c.tipo || '').trim().toUpperCase().startsWith('D'))
        .map((c) => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          grupo: 'SAIDAS',
          disabled: c.eh_cabecalho || c.permite_lancamentos === false,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
        })),
    },
    {
      label: 'ENTRADAS',
      options: categorias
        .filter((c) => (c.tipo || '').trim().toUpperCase().startsWith('R'))
        .map((c) => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          grupo: 'ENTRADAS',
          disabled: c.eh_cabecalho || c.permite_lancamentos === false,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
        })),
    },
  ], [categorias]);

  const entidadeOptions = useMemo(() => [
    {
      label: 'Interessados',
      options: [
        { id: '', label: 'Selecione...' },
        ...entidades
          .slice()
          .sort((a: any, b: any) => String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR'))
          .map((e: any) => ({ id: e.id, label: e.nome || e.razao_social || `Interessado ${e.id}` })),
      ],
    },
  ], [entidades]);

  const contasAtivas = contas.filter(
    (conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'
  );

  const getContasAtivasByCentro = (centroCustoId?: string | number | null) => {
    return contasAtivas.filter(
      (conta) => !centroCustoId || String(conta.centro_custo_id) === String(centroCustoId)
    );
  };

  if (!showDrawer) return null;

  return (
    <div
      className={`${
        embedFullscreenDrawer
          ? 'absolute inset-0 z-10 flex justify-end bg-slate-50 dark:bg-slate-900'
          : 'fixed inset-0 z-50 flex justify-end'
      }`}
    >
      {!embedFullscreenDrawer && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => void requestCloseDrawer()}></div>
      )}
      <div className={`${embedFullscreenDrawer ? 'relative z-10 flex h-full w-full' : 'relative z-10 flex h-full'}`}>
        {shouldShowParcelasSerie && (
          <aside className="hidden h-full w-[33vw] min-w-[420px] max-w-[560px] flex-col border-r border-slate-200 bg-white p-4 shadow-2xl backdrop-blur lg:flex dark:border-slate-700 dark:bg-slate-900/98">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-700 dark:text-slate-200">
                  Série de Parcelas
                </p>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Parcela atual {currentParcelaNumber}/{currentParcelaTotal}
                </p>
              </div>
            </div>

            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={ajustarParaDiaUtil}
                onChange={(e) => setAjustarParaDiaUtil(e.target.checked)}
                className="accent-blue-500"
              />
              Ajustar vencimentos para próximo dia útil ao salvar
            </label>

            <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/70">
              {parcelasSerieLoading ? (
                <div className="p-3 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando parcelas...
                </div>
              ) : sortedParcelasSerie.length === 0 ? (
                <div className="p-3 text-xs text-slate-600 dark:text-slate-300">
                  Não há outras parcelas identificadas para esta série.
                </div>
              ) : (
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        <th className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Parcela</th>
                        <th className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                        <th className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedParcelasSerie.map((item) => {
                        const isCurrent = Number(item.id) === Number(formData.id);
                        return (
                          <tr
                            key={item.id}
                            onClick={() => handleSelecionarParcelaSerie(item)}
                            className={`cursor-pointer border-t border-slate-200 transition dark:border-slate-800 ${
                              isCurrent ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                            }`}
                          >
                            <td className="px-2 py-2 text-xs font-black text-slate-700 dark:text-slate-300">
                              {item.numero_parcela || '-'}
                            </td>
                            <td className="px-2 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                              <p className="truncate">{item.descricao || 'Sem descrição'}</p>
                            </td>
                            <td className="px-2 py-2 text-right text-xs font-black text-slate-700 dark:text-slate-100 whitespace-nowrap">
                              {BRL.format(Number(item.valor_previsto || 0))}
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="date"
                                value={parcelasVencimentosEdit[item.id] || item.data_vencimento || ''}
                                onChange={(e) =>
                                  setParcelasVencimentosEdit((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                onClick={(e) => e.stopPropagation()}
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </aside>
        )}

        <div
          className={`relative bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-700 ${
            drawerPanelClassName || (embedFullscreenDrawer ? 'w-full max-w-none' : 'w-full max-w-xl')
          }`}
        >
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing ? 'Editar' : 'Novo'} Lançamento</h2>
            <div className="flex items-center gap-1">
              {isEditing && (
                <button
                  type="button"
                  title="Duplicar este lançamento"
                  onClick={() => {
                    setIsEditing(false);
                    setFormData((prev: any) => ({
                      ...prev,
                      id: null,
                      status: 'PENDENTE',
                      data_pagamento: prev.data_vencimento,
                      valor_pago: '',
                      is_parcelado: false,
                      anexos: [],
                    }));
                    setFilesToUpload(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicar
                </button>
              )}
              {isEditing && canOpenParcelasSerie && !isBoletimEmbed && (
                <button
                  type="button"
                  title="Abrir a série completa de parcelas"
                  onClick={() => void handleVerTodasParcelas()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-200 bg-amber-100/80 dark:bg-amber-500/15 border border-amber-300/80 dark:border-amber-700/70 hover:bg-amber-200/80 dark:hover:bg-amber-500/25 transition"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Ver todas as parcelas
                </button>
              )}
              <button
                onClick={() => void requestCloseDrawer()}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400 outline-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
            {/* INTERESSADO */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Interessado</label>
                <button
                  onClick={openEntityDrawer}
                  className="text-[10px] text-blue-400 font-bold hover:text-blue-300 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Nova
                </button>
              </div>
              <SearchableSelect
                placeholder="Selecione..."
                options={entidadeOptions}
                value={formData.entidade_id}
                onChange={(id: any) => {
                  const eid = String(id || '');
                  const last = lancamentos.find((l) => String(l.entidade_id) === eid);
                  setFormData((prev: any) => {
                    const hasCategoriaSelecionada = Boolean(prev.plano_contas_id);
                    if (!last || hasCategoriaSelecionada) {
                      return { ...prev, entidade_id: eid };
                    }
                    return {
                      ...prev,
                      entidade_id: eid,
                      plano_contas_id: last.plano_contas_id,
                      tipo: last.tipo,
                    };
                  });
                }}
              />
            </div>

            {/* DESCRIÇÃO E VALORES */}
            <InputDark
              label="Descrição"
              autoFocus
              value={formData.descricao}
              onChange={(e: any) => setFormData((prev: any) => ({ ...prev, descricao: e.target.value }))}
              placeholder="Ex: Conta de Luz"
            />
            <div className="grid grid-cols-2 gap-4">
              <InputDark
                label={formData.cartao_id ? 'Data da compra' : 'Vencimento'}
                type="date"
                value={formData.data_vencimento}
                onChange={(e: any) => handleVencimentoChange(e.target.value)}
              />
              <CurrencyInputDark
                label="Valor (R$)"
                className="font-bold text-lg text-blue-400"
                value={formData.valor_previsto}
                onValueChange={(value: string) => handleValorPrevistoChange(value)}
              />
            </div>

            {/* PARCELAMENTO */}
            {!isCaixaMode && (
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <ToggleSimNao
                  label="Pagamento parcelado"
                  value={!!formData.is_parcelado}
                  onChange={(next) => setFormData((prev: any) => ({ ...prev, is_parcelado: next }))}
                />

                {formData.is_parcelado && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <InputDark
                        label="Qtd. de parcelas"
                        type="number"
                        min={2}
                        value={formData.qtd_parcelas}
                        onChange={(e: any) =>
                          setFormData((prev: any) => ({
                            ...prev,
                            qtd_parcelas: Math.max(2, Number(e.target.value) || 2),
                          }))
                        }
                      />
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cálculo</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setFormData((prev: any) => ({ ...prev, modo_calculo: 'TOTAL' }))}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${
                              formData.modo_calculo === 'TOTAL'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            Total
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormData((prev: any) => ({ ...prev, modo_calculo: 'PARCELA' }))}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${
                              formData.modo_calculo === 'PARCELA'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            Por parcela
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Competência das parcelas</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData((prev: any) => ({ ...prev, competencia_modo_parcelamento: 'POR_PARCELA' }))}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${
                            formData.competencia_modo_parcelamento === 'POR_PARCELA'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          Por parcela
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData((prev: any) => ({ ...prev, competencia_modo_parcelamento: 'MES_COMPRA' }))}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${
                            formData.competencia_modo_parcelamento === 'MES_COMPRA'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          Mês da compra
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Por parcela: cada parcela entra no mês correspondente. Mês da compra: todas as parcelas ficam na competência
                        da compra.
                      </p>
                    </div>

                    {formData.valor_previsto && formData.qtd_parcelas && (
                      <div className="text-xs text-slate-400">
                        {formData.modo_calculo === 'TOTAL' ? (
                          <>
                            {formData.qtd_parcelas}x de{' '}
                            <strong className="text-blue-300">
                              {BRL.format(Number(formData.valor_previsto) / Number(formData.qtd_parcelas || 1))}
                            </strong>
                          </>
                        ) : (
                          <>
                            {formData.qtd_parcelas}x de <strong className="text-blue-300">{BRL.format(Number(formData.valor_previsto))}</strong>{' '}
                            • Total {BRL.format(Number(formData.valor_previsto) * Number(formData.qtd_parcelas || 1))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <InputDark
                label="Competência (MM-AAAA)"
                placeholder="02-2026"
                value={formData.competencia}
                onChange={(e: any) => handleCompetenciaChange(e.target.value)}
              />
              {!isCaixaMode && (
                <ToggleSimNao
                  label="Esse valor é previsto?"
                  value={!!formData.previsto}
                  onChange={(next) => setFormData((prev: any) => ({ ...prev, previsto: next }))}
                />
              )}
            </div>

            {/* CATEGORIA */}
            <div>
              <SearchableSelect
                label="Categoria"
                placeholder="Selecione..."
                options={catOptions}
                value={formData.plano_contas_id}
                onChange={(id: any) => {
                  const cat = categorias.find((c) => String(c.id) === String(id));
                  const tipoCat = String(cat?.tipo || '').trim().toUpperCase();
                  setFormData((prev: any) => ({
                    ...prev,
                    plano_contas_id: id,
                    tipo: tipoCat.startsWith('R') ? 'RECEITA' : 'DESPESA',
                  }));
                }}
              />
            </div>

            {formData.cartao_id && formData.data_vencimento && (
              <div className="text-xs text-slate-400">
                Vencimento da fatura:{' '}
                <strong className="text-blue-300">
                  {computeCartaoVencimento(formData.data_vencimento, formData.cartao_id, cartoes) || '—'}
                </strong>
              </div>
            )}

            {/* PAGAMENTO */}
            {!isCaixaMode && (
              <div ref={pagamentoSectionRef} className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <ToggleSimNao label="Já foi pago/recebido?" value={formData.status === 'PAGO'} onChange={handleStatusPagoChange} />
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out ${
                    formData.status === 'PAGO' ? 'max-h-48 opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
                  }`}
                >
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <InputDark
                      label="Data da Baixa"
                      type="date"
                      value={formData.data_pagamento}
                      onChange={(e: any) => handleDataPagamentoChange(e.target.value)}
                    />
                    <CurrencyInputDark
                      label="Valor Pago (R$)"
                      className="text-emerald-400 font-bold"
                      value={formData.valor_pago}
                      onValueChange={(value: string) => handleValorPagoChange(value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* CENTRO DE CUSTO E ORIGEM DOS RECURSOS (COM FILTRAGEM INTELIGENTE) */}
            {!isCaixaMode && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Centro de Custo</label>
                <div className="mb-3">
                  <select
                    className="w-full p-2 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 outline-none"
                    value={formData.centro_custo_id}
                    onChange={(e) =>
                      setFormData((prev: any) => ({
                        ...prev,
                        centro_custo_id: e.target.value,
                        conta_id: '',
                        cartao_id: '',
                      }))
                    }
                  >
                    <option value="">Selecione um centro de custo</option>
                    {centros.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-800/30 space-y-4">
                  {(() => {
                    const contasAtivasNoCentro = getContasAtivasByCentro(formData.centro_custo_id);
                    return (
                      <>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-out ${
                            formData.status === 'PAGO' ? 'max-h-[55vh] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          <div className="pb-1 max-h-[52vh] overflow-y-auto pr-1 custom-scrollbar">
                            <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                              <Wallet className="w-3 h-3" /> Contas Bancárias
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {contasAtivasNoCentro.length === 0 && (
                                <span className="text-xs text-slate-500 italic col-span-2">
                                  Nenhuma conta ativa neste centro.
                                </span>
                              )}
                              {contasAtivasNoCentro.map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => toggleConta(c.id)}
                                  className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${
                                    formData.conta_id === c.id
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  <div
                                    className={`p-1 rounded ${
                                      formData.conta_id === c.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-emerald-500'
                                    }`}
                                  >
                                    <BankAvatar
                                      logoUrl={getFullLogoUrl(c.logo_url)}
                                      bankName={c.banco}
                                      accountName={c.nome}
                                      integrationType={c.tipo_integracao}
                                      size="sm"
                                      className="h-4 w-4"
                                      imageClassName="rounded-sm"
                                      fallbackClassName="rounded-sm border-0 shadow-none"
                                    />
                                  </div>
                                  {c.nome}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* CARTÕES */}
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                            <CreditCard className="w-3 h-3" /> Cartões de Crédito
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {cartoes.filter(
                              (c) => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id)
                            ).length === 0 && (
                              <span className="text-xs text-slate-500 italic col-span-2">Nenhum cartão neste centro.</span>
                            )}
                            {cartoes
                              .filter((c) => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id))
                              .map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => toggleCartao(c.id)}
                                  className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${
                                    formData.cartao_id === c.id
                                      ? 'bg-purple-600 text-white border-purple-500 shadow-md'
                                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  <div
                                    className={`p-1 rounded ${
                                      formData.cartao_id === c.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-purple-500'
                                    }`}
                                  >
                                    <CreditCard className="w-3 h-3" />
                                  </div>{' '}
                                  {c.nome_cartao}
                                </div>
                              ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <InputDark
                label="Código de barras"
                value={formData.observacao || ''}
                onChange={(e: any) => setFormData((prev: any) => ({ ...prev, observacao: e.target.value }))}
                placeholder="Cole aqui o código de barras para facilitar copiar e colar no pagamento"
              />
              {formData.observacao && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(String(formData.observacao || ''));
                        pushToast('success', 'Código de barras copiado.');
                      } catch {
                        pushToast('error', 'Não foi possível copiar o código de barras.');
                      }
                    }}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Copiar código
                  </button>
                </div>
              )}
            </div>

            {/* ANEXOS */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Anexos</label>

              {formData.anexos && formData.anexos.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {formData.anexos.map((anexo: Anexo) => {
                    const anexoUrl = resolveAnexoUrl(anexo.url);
                    return (
                      <div
                        key={anexo.id}
                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-xs group hover:border-blue-500 transition"
                      >
                        {getFileIcon(anexo.nome_arquivo)}
                        <a
                          href={anexoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 truncate text-slate-700 dark:text-slate-200 hover:text-blue-400 font-medium"
                        >
                          {anexo.nome_arquivo}
                        </a>
                        <a
                          href={anexoUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-white rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleRemoverAnexo(anexo)}
                          className="p-1 text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30"
                          title="Remover anexo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-8 text-center hover:border-blue-500 relative cursor-pointer bg-slate-100 dark:bg-slate-800/40 hover:bg-slate-200 dark:hover:bg-slate-800 transition group shadow-sm">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.ppt,.pptx"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={(e) => setFilesToUpload(e.target.files)}
                />
                <UploadCloud className="w-10 h-10 mx-auto text-slate-500 mb-3 group-hover:text-blue-500 transition-colors" />
                <p className="text-base font-semibold text-slate-600 dark:text-slate-300">Arraste ou clique para anexar</p>
                <p className="text-xs text-slate-500 mt-1">PDF, Imagens, Excel, PowerPoint</p>
                <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-slate-600 dark:bg-slate-700 text-slate-100 text-sm font-bold group-hover:bg-blue-600 transition-colors">
                  Selecionar arquivos
                </div>
                {filesToUpload && <p className="text-xs text-blue-400 font-bold mt-2">{filesToUpload.length} novos arquivos</p>}
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex justify-end gap-3">
            <button
              onClick={() => void requestCloseDrawer()}
              className="px-5 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-8 py-2.5 rounded-lg font-bold shadow-lg flex items-center gap-2 transition disabled:opacity-50 ${
                hasUnsavedDrawerChanges
                  ? 'bg-yellow-400 text-slate-950 hover:bg-yellow-300 ring-2 ring-yellow-300/70 animate-pulse'
                  : 'bg-slate-200 text-slate-800 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'
              }`}
            >
              {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

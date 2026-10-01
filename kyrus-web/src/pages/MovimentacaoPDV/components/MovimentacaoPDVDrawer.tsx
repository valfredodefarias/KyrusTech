import React, { useState, useEffect } from 'react';
import {
  User, Mail, Clock, Globe, PlusCircle, MinusCircle, RefreshCw
} from 'lucide-react';
import { SearchableSelect } from '../../../components/SearchableSelect';
import { api, normalizeListResponse } from '../../../services/api';
import { useLookupStore } from '../../../store/lookupStore';
import type { MovimentacaoPDV } from '../../../store/pdvMovimentacaoStore';

interface AuditDateTimeInfo {
  formattedLocal: string;
  timeZoneName: string;
  isDifferentTz: boolean;
  storeBrasiliaStr?: string;
}

function getAuditDateTimeInfo(
  createdAt?: string | null,
  dataCriacao?: string | null,
  horaCriacao?: string | null,
  fallbackDate?: string | null
): AuditDateTimeInfo {
  let viewerTz = 'America/Sao_Paulo';
  try {
    viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {}

  const brazilTimeZones = [
    'America/Sao_Paulo', 'America/Fortaleza', 'America/Recife', 'America/Bahia',
    'America/Belem', 'America/Maceio', 'America/Araguaina', 'America/Cuiaba',
    'America/Campo_Grande', 'America/Porto_Velho', 'America/Boa_Vista',
    'America/Manaus', 'America/Rio_Branco'
  ];

  const isDifferentTz = !brazilTimeZones.includes(viewerTz);

  let storeBrasiliaStr = '';
  if (dataCriacao) {
    const parts = dataCriacao.split('-');
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dataCriacao;
    const timeStr = horaCriacao ? ` às ${horaCriacao}` : '';
    storeBrasiliaStr = `${dateStr}${timeStr}`;
  }

  if (createdAt) {
    try {
      const d = new Date(createdAt);
      if (!isNaN(d.getTime())) {
        const formattedLocal = d.toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: viewerTz
        });
        const brasiliaFormatted = d.toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: 'America/Sao_Paulo'
        });
        return {
          formattedLocal,
          timeZoneName: viewerTz,
          isDifferentTz,
          storeBrasiliaStr: storeBrasiliaStr || brasiliaFormatted
        };
      }
    } catch {}
  }

  if (storeBrasiliaStr) {
    return {
      formattedLocal: storeBrasiliaStr,
      timeZoneName: 'America/Sao_Paulo',
      isDifferentTz: false,
      storeBrasiliaStr
    };
  }

  return {
    formattedLocal: fallbackDate || '--/--/----',
    timeZoneName: 'America/Sao_Paulo',
    isDifferentTz: false
  };
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export interface MovimentacaoPDVDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (savedItem?: any) => void;
  movimentacao?: MovimentacaoPDV | null;
  movimentacaoId?: number | string | null;
  initialTipo?: 'ENTRADA' | 'SAIDA';
  companyName?: string;
  pdvConfig?: any;
  contas?: any[];
  centrosCusto?: any[];
}

const CARD_BRAND_OPTIONS = [
  { id: 'VISA', label: 'Visa' },
  { id: 'MASTERCARD', label: 'Mastercard' },
  { id: 'ELO', label: 'Elo' },
  { id: 'HIPERCARD', label: 'Hipercard' },
  { id: 'AMEX', label: 'Amex' },
];
const CARD_BRANDS = CARD_BRAND_OPTIONS.map((b) => b.id);

export function MovimentacaoPDVDrawer({
  isOpen,
  onClose,
  onSuccess,
  movimentacao: initialMov,
  movimentacaoId,
  initialTipo = 'ENTRADA',
  companyName,
  pdvConfig: initialPdvConfig,
  contas: initialContas,
  centrosCusto: initialCentrosCusto,
}: MovimentacaoPDVDrawerProps) {
  const [editingMov, setEditingMov] = useState<MovimentacaoPDV | null>(initialMov || null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states
  const [formTipo, setFormTipo] = useState<'ENTRADA' | 'SAIDA'>(initialTipo);
  const [formDescricao, setFormDescricao] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formData, setFormData] = useState('');
  const [formFormaPagamento, setFormFormaPagamento] = useState('DINHEIRO');
  const [formBandeira, setFormBandeira] = useState('');
  const [formParcelas, setFormParcelas] = useState(1);
  const [formCentroCustoId, setFormCentroCustoId] = useState('');
  const [formContaId, setFormContaId] = useState('');

  // Fallback lookups
  const lookupStore = useLookupStore();
  const [localPdvConfig, setLocalPdvConfig] = useState<any>(initialPdvConfig || null);
  const [localContas, setLocalContas] = useState<any[]>(initialContas || []);
  const [localCentros, setLocalCentros] = useState<any[]>(initialCentrosCusto || []);

  useEffect(() => {
    if (!isOpen) return;

    if (!initialContas || initialContas.length === 0) {
      lookupStore.fetchContas().then(setLocalContas).catch(() => {});
    } else {
      setLocalContas(initialContas);
    }

    if (!initialCentrosCusto || initialCentrosCusto.length === 0) {
      lookupStore.fetchCentrosCusto().then(setLocalCentros).catch(() => {});
    } else {
      setLocalCentros(initialCentrosCusto);
    }

    if (!initialPdvConfig) {
      api.get('/config/pdv').then(res => setLocalPdvConfig(res.data)).catch(() => {});
    } else {
      setLocalPdvConfig(initialPdvConfig);
    }
  }, [isOpen, initialContas, initialCentrosCusto, initialPdvConfig]);

  // Load item by ID if not provided
  useEffect(() => {
    if (!isOpen) return;

    if (initialMov) {
      setEditingMov(initialMov);
      populateForm(initialMov);
    } else if (movimentacaoId) {
      setLoadingItem(true);
      api.get<MovimentacaoPDV>(`/pdv/movimentacoes/${movimentacaoId}`)
        .then((res) => {
          setEditingMov(res.data);
          populateForm(res.data);
        })
        .catch((err) => {
          console.error("Erro ao carregar movimentação:", err);
          alert(err?.response?.data?.detail || "Erro ao carregar detalhes da movimentação.");
          onClose();
        })
        .finally(() => setLoadingItem(false));
    } else {
      setEditingMov(null);
      setFormTipo(initialTipo);
      setFormDescricao(initialTipo === 'ENTRADA' ? 'Venda Frente de Caixa' : 'Sangria / Retirada');
      setFormValor('');
      setFormData(new Date().toISOString().substring(0, 10));
      setFormFormaPagamento('DINHEIRO');
      setFormBandeira('');
      setFormParcelas(1);
      setFormCentroCustoId(localPdvConfig?.pdv_centro_custo_padrao_id ? String(localPdvConfig.pdv_centro_custo_padrao_id) : '');
      setFormContaId(localPdvConfig?.pdv_conta_padrao_id ? String(localPdvConfig.pdv_conta_padrao_id) : '');
    }
  }, [isOpen, initialMov, movimentacaoId]);

  function populateForm(mov: MovimentacaoPDV) {
    setFormTipo(mov.tipo as 'ENTRADA' | 'SAIDA');
    setFormDescricao(mov.descricao || (mov.tipo === 'ENTRADA' ? 'Venda Frente de Caixa' : 'Sangria / Retirada'));
    setFormValor(String(mov.valor || ''));
    setFormData(mov.data ? mov.data.substring(0, 10) : new Date().toISOString().substring(0, 10));
    setFormFormaPagamento(mov.forma_pagamento || 'DINHEIRO');
    setFormBandeira(mov.bandeira || '');
    setFormParcelas(mov.parcelas || 1);
    setFormCentroCustoId(mov.centro_custo_id ? String(mov.centro_custo_id) : '');
    setFormContaId(mov.conta_id ? String(mov.conta_id) : '');
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(formValor);
    if (isNaN(val) || val <= 0) {
      alert('Informe um valor válido maior que zero.');
      return;
    }
    const isCartao = formTipo === 'ENTRADA' && (formFormaPagamento === 'DEBITO' || formFormaPagamento.startsWith('CREDITO'));
    if (isCartao && !CARD_BRANDS.includes(formBandeira)) {
      alert('Selecione a bandeira do cartão.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tipo: formTipo,
        descricao: formDescricao,
        valor: val,
        forma_pagamento: formTipo === 'SAIDA' ? 'DINHEIRO' : formFormaPagamento,
        bandeira: formTipo === 'SAIDA' ? 'OUTROS' : formBandeira,
        parcelas: formTipo === 'SAIDA' ? 1 : formParcelas,
        data: formData,
        centro_custo_id: (localPdvConfig?.pdv_centro_custo_flexivel ?? localPdvConfig?.centro_custo_flexivel) !== false
          ? (formCentroCustoId ? Number(formCentroCustoId) : null)
          : ((localPdvConfig?.pdv_centro_custo_padrao_id ?? localPdvConfig?.centro_custo_padrao_id) ? Number(localPdvConfig.pdv_centro_custo_padrao_id ?? localPdvConfig.centro_custo_padrao_id) : null),
        conta_id: formContaId ? Number(formContaId) : null
      };

      let responseData: any;
      if (editingMov) {
        const res = await api.put(`/pdv/movimentacoes/${editingMov.id}`, payload);
        responseData = res.data;
      } else {
        const res = await api.post('/pdv/movimentacoes', payload);
        responseData = res.data;
      }

      onSuccess?.(responseData);
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar movimentação:', err);
      alert(err?.response?.data?.detail || 'Erro ao registrar movimentação.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 transition-opacity"
        onClick={() => !saving && onClose()}
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-xl md:max-w-2xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250 rounded-none">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/20 dark:bg-slate-950/10">
          <div>
            <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">
              {editingMov ? 'Editar Movimentação' : `Registrar ${formTipo === 'ENTRADA' ? 'Entrada / Venda' : 'Saída / Sangria'}`}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
              Frente de Caixa{companyName ? ` — Filial ${companyName}` : ''}
            </p>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="p-1.5 rounded-none border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-655 cursor-pointer bg-transparent"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {loadingItem ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mb-2" />
            <span className="text-xs font-bold">Carregando detalhes da movimentação...</span>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Informações de Auditoria: Criador da Venda / Movimentação */}
            {editingMov && (
              <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-none space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <User className="w-4 h-4 text-blue-500" />
                    Auditoria de Criação
                  </span>
                  {editingMov.id_parcelamento ? (
                    <span className="text-xs font-mono font-bold px-2 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-none">
                      Origem: Venda PDV
                    </span>
                  ) : (
                    <span className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-none">
                      Lançamento Manual
                    </span>
                  )}
                </div>

                <div className="space-y-2.5 text-xs">
                  {/* Criado por (Nome e Email) */}
                  <div className="flex items-start gap-3 bg-white dark:bg-slate-900 p-3 border border-slate-150 dark:border-slate-800/80">
                    <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 mt-0.5">
                      {editingMov.criador_nome ? editingMov.criador_nome.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-slate-850 dark:text-white truncate">
                        {editingMov.criador_nome || 'Usuário do Caixa / Sistema'}
                      </div>
                      {editingMov.criador_email ? (
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate font-mono mt-0.5">
                          <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          {editingMov.criador_email}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic mt-0.5">E-mail não disponível</div>
                      )}
                    </div>
                  </div>

                  {/* Data e Hora */}
                  {(() => {
                    const auditInfo = getAuditDateTimeInfo(editingMov.created_at, editingMov.data_criacao, editingMov.hora_criacao, editingMov.data);
                    return (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 bg-white dark:bg-slate-900 px-3 py-2.5 border border-slate-150 dark:border-slate-800/80 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium shrink-0">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Criado em:
                        </span>
                        <div className="flex flex-col sm:items-end">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                              {auditInfo.formattedLocal}
                            </span>
                            {auditInfo.isDifferentTz ? (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50"
                                title={`Horário convertido automaticamente para o seu fuso local (${auditInfo.timeZoneName})`}
                              >
                                <Globe className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                {auditInfo.timeZoneName}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                                (Brasília)
                              </span>
                            )}
                          </div>
                          {auditInfo.isDifferentTz && auditInfo.storeBrasiliaStr && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                              Horário da loja: {auditInfo.storeBrasiliaStr} (Brasília)
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Tipo */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Tipo *</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setFormTipo('ENTRADA'); if (formDescricao === 'Sangria / Retirada') setFormDescricao('Venda Frente de Caixa'); }}
                  className={`py-3.5 flex items-center justify-center gap-2.5 border font-bold text-sm cursor-pointer rounded-none transition ${
                    formTipo === 'ENTRADA'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-850'
                  }`}
                >
                  <PlusCircle className="w-5 h-5 text-emerald-650" />
                  <span>Entrada</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setFormTipo('SAIDA'); if (formDescricao === 'Venda Frente de Caixa') setFormDescricao('Sangria / Retirada'); }}
                  className={`py-3.5 flex items-center justify-center gap-2.5 border font-bold text-sm cursor-pointer rounded-none transition ${
                    formTipo === 'SAIDA'
                      ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/20 dark:border-rose-700 dark:text-rose-400'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-850'
                  }`}
                >
                  <MinusCircle className="w-5 h-5 text-rose-650" />
                  <span>Saída</span>
                </button>
              </div>
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Descrição *</label>
              <input
                type="text"
                value={formDescricao}
                onChange={(e) => setFormDescricao(e.target.value)}
                className="w-full rounded-none border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                required
              />
            </div>

            {/* Valor */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Valor R$ *</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formValor}
                onChange={(e) => setFormValor(e.target.value)}
                className="w-full rounded-none border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-800 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono font-bold"
                required
              />
            </div>

            {/* Data */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Data do Registro *</label>
              <input
                type="date"
                value={formData}
                onChange={(e) => setFormData(e.target.value)}
                className="w-full rounded-none border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                required
              />
            </div>

            {/* Centro de Custo */}
            {(!localPdvConfig || (localPdvConfig.pdv_centro_custo_flexivel ?? localPdvConfig.centro_custo_flexivel) !== false || !(localPdvConfig.pdv_centro_custo_padrao_id ?? localPdvConfig.centro_custo_padrao_id)) && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Centro de Custo *</label>
                {(localPdvConfig?.pdv_centro_custo_flexivel ?? localPdvConfig?.centro_custo_flexivel) ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {localCentros.map((cc) => {
                      const isSelected = String(formCentroCustoId) === String(cc.id);
                      return (
                        <button
                          key={cc.id}
                          type="button"
                          onClick={() => setFormCentroCustoId(String(cc.id))}
                          className={`px-4 py-2.5 rounded-xl border text-sm font-bold transition cursor-pointer ${
                            isSelected
                              ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/20 dark:border-rose-700 dark:text-rose-400'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-350 dark:hover:bg-slate-900'
                          }`}
                        >
                          {cc.nome}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <SearchableSelect
                    options={[{ label: 'Centros', options: localCentros.map(cc => ({ id: String(cc.id), label: cc.nome })) }]}
                    value={formCentroCustoId}
                    onChange={(v) => setFormCentroCustoId(String(v))}
                    placeholder="Selecione..."
                  />
                )}
              </div>
            )}

            {/* Conta */}
            {!localPdvConfig?.pdv_conta_padrao_id && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Conta / Caixa *</label>
                <SearchableSelect
                  options={[{ label: 'Contas', options: localContas.map(c => ({ id: String(c.id), label: c.nome })) }]}
                  value={formContaId}
                  onChange={(v) => setFormContaId(String(v))}
                  placeholder="Selecione..."
                />
              </div>
            )}

            {/* Forma de Pagamento (apenas ENTRADA) */}
            {formTipo === 'ENTRADA' && (
              <>
                <div className="space-y-2 mt-4">
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Forma de Pagamento *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {[
                      { id: 'DINHEIRO', label: 'Dinheiro' },
                      { id: 'PIX', label: 'Pix' },
                      { id: 'DEBITO', label: 'Cartão de Débito' },
                      { id: 'CREDITO_AVISTA', label: 'Crédito à Vista' },
                      { id: 'CREDITO_PARCELADO', label: 'Crédito Parcelado' }
                    ].map(forma => (
                      <button
                        key={forma.id}
                        type="button"
                        onClick={() => {
                          const val = forma.id;
                          setFormFormaPagamento(val);
                          if (!val.includes('CREDITO') && !val.includes('DEBITO')) {
                            setFormBandeira('');
                            setFormParcelas(1);
                          }
                        }}
                        className={`px-4 py-2.5 border rounded-md text-sm font-semibold transition-all ${
                          formFormaPagamento === forma.id 
                            ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 ring-1 ring-blue-500' 
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        {forma.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(formFormaPagamento === 'DEBITO' || formFormaPagamento.startsWith('CREDITO')) && (
                  <div className="space-y-2 mt-4">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Bandeira *</label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {CARD_BRAND_OPTIONS.map(bandeira => (
                        <button
                          key={bandeira.id}
                          type="button"
                          onClick={() => setFormBandeira(bandeira.id)}
                          className={`px-4 py-2.5 border rounded-md text-sm font-semibold transition-all ${
                            formBandeira === bandeira.id 
                              ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 ring-1 ring-blue-500' 
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          {bandeira.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {formFormaPagamento === 'CREDITO_PARCELADO' && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Número de Parcelas *</label>
                    <input
                      type="number"
                      min="2"
                      max="12"
                      value={formParcelas}
                      onChange={(e) => setFormParcelas(Number(e.target.value))}
                      className="w-full rounded-none border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                      required
                    />
                  </div>
                )}
              </>
            )}
          </form>
        )}

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50/20 dark:bg-slate-950/10 shrink-0">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-6 py-2.5 border border-slate-205 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer rounded-none font-bold text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loadingItem}
            onClick={handleSave}
            className="px-7 py-2.5 bg-slate-900 text-white hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-750 border-none transition rounded-none font-bold text-sm cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Gravando...' : 'Salvar Registro'}
          </button>
        </div>

      </div>
    </>
  );
}

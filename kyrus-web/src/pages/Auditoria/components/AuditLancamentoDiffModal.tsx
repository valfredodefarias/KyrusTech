import React, { useState, useEffect } from 'react';
import {
  X,
  Undo2,
  Clock,
  User,
  Wallet,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  PlusCircle,
  Trash2,
  Edit3,
  Columns,
  Maximize2,
  Building2
} from 'lucide-react';
import { api } from '../../../services/api';
import { useLookupStore } from '../../../store/lookupStore';
import { BankAvatar } from '../../../components/BrandAvatar';

interface ChangeItem {
  old: any;
  new: any;
}

interface AuditLancamentoDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  log: {
    id: number;
    table_name?: string;
    record_id?: number;
    friendly_table_name?: string;
    friendly_action?: string;
    action?: string;
    user_email?: string;
    created_at: string;
    changes?: Record<string, ChangeItem>;
    friendly_details: string[];
    is_undoable: boolean;
    undone?: boolean;
  } | null;
  onUndo?: (logId: number) => Promise<void>;
  isUndoLoading?: boolean;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const formatMoney = (val: any) => {
  if (val === null || val === undefined || val === '') return 'R$ 0,00';
  const num = Number(val);
  return Number.isFinite(num) ? BRL.format(num) : String(val);
};

const formatDate = (val: any) => {
  if (!val) return '—';
  const s = String(val).slice(0, 10);
  const parts = s.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return s;
};

export const AuditLancamentoDiffModal: React.FC<AuditLancamentoDiffModalProps> = ({
  isOpen,
  onClose,
  log,
  onUndo,
  isUndoLoading = false,
}) => {
  const { planoContas, contas, entidades, centrosCusto, fetchContas, contasLoaded } = useLookupStore();
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [viewMode, setViewMode] = useState<'both' | 'after' | 'before'>('both');

  useEffect(() => {
    if (!contasLoaded || contas.length === 0) {
      fetchContas();
    }
  }, [contasLoaded, contas.length, fetchContas]);

  const isLancamento = log ? (log.table_name === 'lancamentos' || log.friendly_table_name === 'Lançamentos') : false;
  const isBaixa = log ? (log.table_name === 'baixas' || log.friendly_table_name?.toLowerCase().includes('baixa')) : false;
  const isMovimento = log ? (log.table_name === 'movimentos' || log.friendly_table_name?.toLowerCase().includes('extrato')) : false;

  useEffect(() => {
    if (!isOpen || !log) {
      setSnapshot(null);
      setViewMode('both');
      return;
    }

    setViewMode('both');

    if (isLancamento && log.record_id) {
      setLoadingSnapshot(true);
      api
        .get(`/auditoria/lancamento/${log.record_id}/snapshot`, {
          params: { log_id: log.id },
        })
        .then((res) => {
          setSnapshot(res.data);
        })
        .catch((err) => {
          console.error('Erro ao buscar snapshot do lançamento:', err);
          setSnapshot(null);
        })
        .finally(() => {
          setLoadingSnapshot(false);
        });
    } else if (isBaixa && log.record_id) {
      setLoadingSnapshot(true);
      api
        .get(`/auditoria/baixa/${log.record_id}/snapshot`, {
          params: { log_id: log.id },
        })
        .then((res) => {
          setSnapshot(res.data);
        })
        .catch((err) => {
          console.error('Erro ao buscar snapshot da baixa:', err);
          setSnapshot(null);
        })
        .finally(() => {
          setLoadingSnapshot(false);
        });
    } else if (isMovimento && log.record_id) {
      setLoadingSnapshot(true);
      api
        .get(`/auditoria/movimento/${log.record_id}/snapshot`, {
          params: { log_id: log.id },
        })
        .then((res) => {
          setSnapshot(res.data);
        })
        .catch((err) => {
          console.error('Erro ao buscar snapshot do movimento:', err);
          setSnapshot(null);
        })
        .finally(() => {
          setLoadingSnapshot(false);
        });
    } else {
      setSnapshot(null);
    }
  }, [isOpen, log, isLancamento, isBaixa, isMovimento]);

  if (!isOpen || !log) return null;

  const rawChanges = (snapshot?.changes && Object.keys(snapshot.changes).length > 0)
    ? snapshot.changes
    : (log.changes || {});
  const changedFields = new Set(
    snapshot?.changed_fields && snapshot.changed_fields.length > 0
      ? snapshot.changed_fields
      : Object.keys(rawChanges)
  );

  const action = snapshot?.action || (
    log.friendly_action?.includes('Criação') || log.friendly_action?.includes('Cadastro')
      ? 'CREATE'
      : (log.friendly_action?.includes('Exclusão') || log.action === 'DELETE' || log.action === 'SOFT_DELETE')
      ? 'DELETE'
      : 'UPDATE'
  );
  const isCreate = action === 'CREATE';
  const isDelete = action === 'DELETE' || action === 'SOFT_DELETE' || Boolean(snapshot?.is_deleted);
  const isUpdate = !isCreate && !isDelete;

  // Resolução de valores para o lançamento ou baixa (usando snapshot completo ou fallback)
  const getFieldVal = (field: string, side: 'old' | 'new') => {
    if (snapshot) {
      const src = side === 'old' ? snapshot.values_before : snapshot.values_after;
      if (src && src[field] !== undefined && src[field] !== null) {
        return src[field];
      }
    }
    if (rawChanges[field]) {
      return rawChanges[field][side];
    }
    return undefined;
  };

  const getLookupText = (idField: string, nameField: string, side: 'old' | 'new', lookupList: any[]) => {
    if (snapshot) {
      const src = side === 'old' ? snapshot.values_before : snapshot.values_after;
      if (src && src[nameField]) return src[nameField];
    }
    const val = getFieldVal(idField, side);
    if (!val) return '—';
    const found = lookupList.find((item) => String(item.id) === String(val));
    return found ? (found.nome || found.nome_razao_social || found.razao_social || `#${val}`) : `ID #${val}`;
  };

  // Helper de estilização de inputs idêntico ao LancamentoFormDrawer.tsx
  const getInputClasses = (fieldKey: string, side: 'old' | 'new', extraClasses = '') => {
    const isChanged = changedFields.has(fieldKey) && isUpdate;
    if (isChanged) {
      if (side === 'old') {
        return `w-full p-3 rounded-lg border-2 border-rose-400 bg-rose-50/60 dark:bg-rose-950/30 text-rose-950 dark:text-rose-100 outline-none transition font-medium ${extraClasses}`;
      }
      return `w-full p-3 rounded-lg border-2 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/20 outline-none transition font-medium ${extraClasses}`;
    }
    return `w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none transition ${extraClasses}`;
  };

  const renderLabel = (text: string, fieldKey: string, side: 'old' | 'new') => {
    const isChanged = changedFields.has(fieldKey) && isUpdate;
    return (
      <div className="flex justify-between items-center mb-1">
        <label className="block text-xs font-bold text-slate-400 uppercase">{text}</label>
        {isChanged && (
          <span
            className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
              side === 'old'
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            }`}
          >
            {side === 'old' ? 'Antes' : 'Modificado'}
          </span>
        )}
      </div>
    );
  };

  // Formulário Idêntico ao LancamentoFormDrawer.tsx desativando o editar
  const renderLancamentoForm = (side: 'old' | 'new', titleOverride?: string, customData?: any) => {
    const isCustom = Boolean(customData);
    const isOld = !isCustom && side === 'old';

    const getVal = (field: string) => {
      if (customData && customData[field] !== undefined && customData[field] !== null) {
        return customData[field];
      }
      return getFieldVal(field, side);
    };

    const getInputClassesLocal = (fieldKey: string, extraClasses = '') => {
      if (isCustom) {
        return `w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none transition font-medium ${extraClasses}`;
      }
      return getInputClasses(fieldKey, side, extraClasses);
    };

    const renderLabelLocal = (text: string, fieldKey: string) => {
      if (isCustom) {
        return (
          <div className="flex justify-between items-center mb-1">
            <label className="block text-xs font-bold text-slate-400 uppercase">{text}</label>
          </div>
        );
      }
      return renderLabel(text, fieldKey, side);
    };

    const tipo = String(getVal('tipo') || 'DESPESA').toUpperCase();
    const isReceita = tipo.startsWith('R');

    const descricao = getVal('descricao') || '';
    const dataVencimento = getVal('data_vencimento');
    const valorPrevisto = getVal('valor_previsto');
    const competencia = getVal('competencia') || getVal('data_competencia') || '';
    const previsto = Boolean(getVal('previsto'));

    const categoriaText = customData?.categoria_nome || getLookupText('plano_contas_id', 'categoria_nome', side, planoContas);
    const contaText = customData?.conta_nome || getLookupText('conta_id', 'conta_nome', side, contas);
    const entidadeText = customData?.entidade_nome || getLookupText('entidade_id', 'entidade_nome', side, entidades);
    const centroCustoText = customData?.centro_custo_nome || getLookupText('centro_custo_id', 'centro_custo_nome', side, centrosCusto);

    const status = String(getVal('status') || 'PENDENTE').toUpperCase();
    const isPago = status === 'PAGO' || status === 'CONCILIADO' || Number(getVal('valor_pago') || 0) > 0;
    const dataPagamento = getVal('data_pagamento');
    const valorPago = getVal('valor_pago');
    const observacao = getVal('observacao') || '';

    return (
      <div
        className={`w-full min-w-0 rounded-2xl border p-6 flex flex-col justify-between transition overflow-hidden ${
          isCustom
            ? 'bg-slate-50/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 shadow-sm'
            : isOld
            ? 'bg-rose-50/15 border-rose-200 dark:bg-rose-950/10 dark:border-rose-900/40'
            : isCreate
            ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
            : isDelete
            ? 'bg-rose-50/20 border-rose-300 dark:bg-rose-950/20 dark:border-rose-900/50'
            : 'bg-emerald-50/15 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-900/40'
        }`}
      >
        <div>
          {/* HEADER DO FORMULÁRIO */}
          <div className="flex items-center justify-between pb-3 mb-6 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${
                  isCustom ? 'bg-indigo-500' : isOld ? 'bg-rose-500' : isDelete ? 'bg-rose-600' : 'bg-emerald-500'
                }`}
              />
              <h4
                className={`text-xs font-black uppercase tracking-wider ${
                  isCustom
                    ? 'text-indigo-700 dark:text-indigo-400'
                    : isOld
                    ? 'text-rose-700 dark:text-rose-400'
                    : isDelete
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {titleOverride || (isOld ? 'Valores Anteriores (Antes)' : 'Valores Atualizados (Depois)')}
              </h4>
            </div>
            <div className="flex items-center gap-2">
              {isCustom && customData?.id && (
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  #{customData.id}
                </span>
              )}
              <span
                className={`px-3 py-1 text-xs font-bold rounded-lg uppercase tracking-wider ${
                  isReceita
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                }`}
              >
                {tipo}
              </span>
            </div>
          </div>

          {/* CAMPOS IDÊNTICOS AO LANCAMENTO FORM DRAWER */}
          <div className="space-y-6">
            {/* INTERESSADO */}
            <div>
              {renderLabelLocal('Interessado', 'entidade_id')}
              <div
                className={getInputClassesLocal('entidade_id', 'text-sm truncate select-none')}
                title={entidadeText}
              >
                {entidadeText}
              </div>
            </div>

            {/* DESCRIÇÃO */}
            <div>
              {renderLabelLocal('Descrição', 'descricao')}
              <div
                className={getInputClassesLocal('descricao', 'text-sm font-semibold truncate select-none')}
                title={descricao || '—'}
              >
                {descricao || '—'}
              </div>
            </div>

            {/* VENCIMENTO E VALOR */}
            <div className="grid grid-cols-2 gap-4 min-w-0">
              <div className="min-w-0">
                {renderLabelLocal('Vencimento', 'data_vencimento')}
                <div className={getInputClassesLocal('data_vencimento', 'text-sm font-medium select-none')}>
                  {formatDate(dataVencimento)}
                </div>
              </div>
              <div className="min-w-0">
                {renderLabelLocal('Valor (R$)', 'valor_previsto')}
                <div
                  className={getInputClassesLocal(
                    'valor_previsto',
                    'text-lg font-bold text-blue-500 dark:text-blue-400 truncate select-none'
                  )}
                >
                  {formatMoney(valorPrevisto)}
                </div>
              </div>
            </div>

            {/* COMPETÊNCIA E VALOR PREVISTO */}
            <div className="grid grid-cols-2 gap-4 min-w-0">
              <div className="min-w-0">
                {renderLabelLocal('Competência (MM-AAAA)', 'competencia')}
                <div className={getInputClassesLocal('competencia', 'text-sm select-none')}>
                  {competencia || '—'}
                </div>
              </div>
              <div className="min-w-0">
                {renderLabelLocal('Esse valor é previsto?', 'previsto')}
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`py-3 rounded-lg text-sm font-bold text-center border transition select-none ${
                      previsto
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-900/20'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400'
                    }`}
                  >
                    Sim
                  </div>
                  <div
                    className={`py-3 rounded-lg text-sm font-bold text-center border transition select-none ${
                      !previsto
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-900/20'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400'
                    }`}
                  >
                    Não
                  </div>
                </div>
              </div>
            </div>

            {/* CATEGORIA */}
            <div>
              {renderLabelLocal('Categoria', 'plano_contas_id')}
              <div
                className={getInputClassesLocal('plano_contas_id', 'text-sm font-medium truncate select-none')}
                title={categoriaText}
              >
                {categoriaText}
              </div>
            </div>

            {/* SEÇÃO PAGAMENTO */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
              <div>
                {renderLabelLocal('Já foi pago/recebido?', 'status')}
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`py-3 rounded-lg text-sm font-bold text-center border transition select-none ${
                      isPago
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-900/20'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400'
                    }`}
                  >
                    Sim
                  </div>
                  <div
                    className={`py-3 rounded-lg text-sm font-bold text-center border transition select-none ${
                      !isPago
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-900/20'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400'
                    }`}
                  >
                    Não
                  </div>
                </div>
              </div>

              {isPago && (
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-700 min-w-0">
                  <div className="min-w-0">
                    {renderLabelLocal('Data da Baixa', 'data_pagamento')}
                    <div className={getInputClassesLocal('data_pagamento', 'text-sm font-medium select-none')}>
                      {formatDate(dataPagamento)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    {renderLabelLocal('Valor Pago (R$)', 'valor_pago')}
                    <div
                      className={getInputClassesLocal(
                        'valor_pago',
                        'text-lg font-bold text-emerald-400 truncate select-none'
                      )}
                    >
                      {formatMoney(valorPago)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* CENTRO DE CUSTO */}
            <div>
              {renderLabelLocal('Centro de Custo', 'centro_custo_id')}
              <div
                className={getInputClassesLocal('centro_custo_id', 'text-sm truncate select-none')}
                title={centroCustoText}
              >
                {centroCustoText}
              </div>
            </div>

            {/* CONTA BANCÁRIA */}
            <div>
              {renderLabelLocal('Contas Bancárias (Liquidação / Previsão)', 'conta_id')}
              {(() => {
                const contaIdVal = getVal('conta_id');
                const contaObj = contas.find((c) => String(c.id) === String(contaIdVal));
                return (
                  <div
                    className={`p-2.5 rounded-lg border text-xs font-bold flex gap-2.5 items-center transition select-none ${
                      contaObj
                        ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 border-blue-200 dark:border-blue-800'
                        : contaText && contaText !== '—'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {contaObj ? (
                      <>
                        <div className="p-1 rounded bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-900 shadow-sm shrink-0">
                          <BankAvatar
                            logoUrl={contaObj.logo_url}
                            bankName={contaObj.banco}
                            accountName={contaObj.nome}
                            integrationType={contaObj.tipo_integracao}
                            size="sm"
                            className="h-5 w-5"
                            imageClassName="rounded-sm"
                            fallbackClassName="rounded-sm border-0 shadow-none"
                          />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-xs truncate">{contaObj.nome}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-400 font-mono font-normal">
                            {contaObj.banco ? `${contaObj.banco} · ` : ''}ID #{contaObj.id}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-1 rounded bg-white/20 text-white">
                          <Wallet className="w-3.5 h-3.5" />
                        </div>
                        <span className="truncate">{contaText || 'Nenhuma conta vinculada'}</span>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* OBSERVAÇÕES */}
            <div>
              {renderLabelLocal('Observações', 'observacao')}
              <div
                className={getInputClassesLocal('observacao', 'text-xs text-slate-600 dark:text-slate-300 break-words select-none')}
              >
                {observacao || 'Nenhuma observação registrada.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Formulário consistente para Baixas
  const renderBaixaForm = (side: 'old' | 'new', titleOverride?: string) => {
    const isOld = side === 'old';
    const tipoBaixa = String(getFieldVal('tipo_baixa', side) || 'PRINCIPAL').toUpperCase();
    const lancamentoId = getFieldVal('lancamento_id', side);
    const lancDesc = getFieldVal('lancamento_descricao', side);
    const lancTipo = String(getFieldVal('lancamento_tipo', side) || 'DESPESA').toUpperCase();
    const isReceita = lancTipo.startsWith('R');
    const lancValorPrevisto = getFieldVal('lancamento_valor_previsto', side);
    const contaNome = getFieldVal('conta_nome', side) || getLookupText('conta_id', 'conta_nome', side, contas);
    const movId = getFieldVal('movimento_id', side);

    return (
      <div
        className={`w-full min-w-0 rounded-2xl border p-6 flex flex-col justify-between transition overflow-hidden ${
          isOld
            ? 'bg-rose-50/15 border-rose-200 dark:bg-rose-950/10 dark:border-rose-900/40'
            : isCreate
            ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
            : isDelete
            ? 'bg-rose-50/20 border-rose-300 dark:bg-rose-950/20 dark:border-rose-900/50'
            : 'bg-emerald-50/15 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-900/40'
        }`}
      >
        <div>
          {/* HEADER DO FORMULÁRIO */}
          <div className="flex items-center justify-between pb-3 mb-6 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${
                  isOld ? 'bg-rose-500' : isDelete ? 'bg-rose-600' : 'bg-emerald-500'
                }`}
              />
              <h4
                className={`text-xs font-black uppercase tracking-wider ${
                  isOld
                    ? 'text-rose-700 dark:text-rose-400'
                    : isDelete
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {titleOverride || (isOld ? 'Valores Anteriores (Antes)' : 'Valores Atualizados (Depois)')}
              </h4>
            </div>
            <span className="px-3 py-1 text-xs font-bold rounded-lg uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {tipoBaixa}
            </span>
          </div>

          {/* CARD DO LANÇAMENTO VINCULADO */}
          <div className="mb-6 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                <Receipt className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="truncate">Lançamento #{lancamentoId || '—'}</span>
              </div>
              <span
                className={`px-2.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${
                  isReceita
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                }`}
              >
                {lancTipo}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 truncate font-semibold" title={lancDesc || ''}>
              {lancDesc || 'Lançamento sem descrição'}
            </p>
            {lancValorPrevisto !== undefined && lancValorPrevisto !== null && (
              <div className="text-xs text-slate-400">
                Valor Previsto:{' '}
                <strong className="text-slate-700 dark:text-slate-200">{formatMoney(lancValorPrevisto)}</strong>
              </div>
            )}
          </div>

          {/* CAMPOS DA BAIXA */}
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 min-w-0">
              <div className="min-w-0">
                {renderLabel('Valor Pago (R$)', 'valor_pago', side)}
                <div
                  className={getInputClasses(
                    'valor_pago',
                    side,
                    'text-lg font-bold text-emerald-400 truncate select-none'
                  )}
                >
                  {formatMoney(getFieldVal('valor_pago', side))}
                </div>
              </div>
              <div className="min-w-0">
                {renderLabel('Data da Baixa', 'data_baixa', side)}
                <div className={getInputClasses('data_baixa', side, 'text-sm font-medium select-none')}>
                  {formatDate(getFieldVal('data_baixa', side))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 min-w-0">
              <div className="min-w-0">
                {renderLabel('Tipo de Baixa', 'tipo_baixa', side)}
                <div className={getInputClasses('tipo_baixa', side, 'text-sm select-none')}>
                  {tipoBaixa}
                </div>
              </div>
              <div className="min-w-0">
                {renderLabel('Movimento Extrato', 'movimento_id', side)}
                <div className={getInputClasses('movimento_id', side, 'text-sm select-none')}>
                  {movId ? `#${movId}` : 'Sem extrato'}
                </div>
              </div>
            </div>

            <div>
              {renderLabel('Conta Bancária', 'conta_id', side)}
              {(() => {
                const contaIdVal = getFieldVal('conta_id', side);
                const contaObj = contas.find((c) => String(c.id) === String(contaIdVal));
                return (
                  <div
                    className={`p-2.5 rounded-lg border text-xs font-bold flex gap-2.5 items-center transition select-none ${
                      contaObj
                        ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 border-blue-200 dark:border-blue-800'
                        : contaNome && contaNome !== '—'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {contaObj ? (
                      <>
                        <div className="p-1 rounded bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-900 shadow-sm shrink-0">
                          <BankAvatar
                            logoUrl={contaObj.logo_url}
                            bankName={contaObj.banco}
                            accountName={contaObj.nome}
                            integrationType={contaObj.tipo_integracao}
                            size="sm"
                            className="h-5 w-5"
                            imageClassName="rounded-sm"
                            fallbackClassName="rounded-sm border-0 shadow-none"
                          />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-xs truncate">{contaObj.nome}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-400 font-mono font-normal">
                            {contaObj.banco ? `${contaObj.banco} · ` : ''}ID #{contaObj.id}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-1 rounded bg-white/20 text-white">
                          <Wallet className="w-3.5 h-3.5" />
                        </div>
                        <span className="truncate">{contaNome || 'Nenhuma conta vinculada'}</span>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getFieldFriendlyName = (field: string) => {
    const map: Record<string, string> = {
      conta_id: 'Conta Bancária',
      plano_contas_id: 'Categoria / Plano de Contas',
      categoria_id: 'Categoria / Plano de Contas',
      entidade_id: 'Cliente / Fornecedor (Interessado)',
      centro_custo_id: 'Centro de Custo',
      descricao: 'Descrição',
      descricao_original: 'Descrição Original (Extrato)',
      valor: 'Valor (R$)',
      valor_pago: 'Valor Pago (R$)',
      valor_previsto: 'Valor Previsto (R$)',
      data: 'Data da Movimentação',
      data_vencimento: 'Data de Vencimento',
      data_pagamento: 'Data de Pagamento',
      data_baixa: 'Data da Baixa',
      status: 'Status',
      tipo: 'Tipo',
      origem: 'Origem',
      fitid: 'Código da Transação Bancária (FITID)',
      payee_bruto: 'Favorecido Bruto (Extrato)',
      documento_extrato: 'Documento do Extrato',
      pix_e2e_id: 'ID PIX End-to-End',
      observacao: 'Observação',
      conciliado: 'Conciliado',
      competencia: 'Competência',
    };
    return map[field] || field;
  };

  const renderFormattedDiffValue = (field: string, val: any, side: 'old' | 'new') => {
    if (val === null || val === undefined || val === '' || val === 'None') {
      return <span className="text-slate-400 italic font-sans">—</span>;
    }

    // 1. CONTA BANCÁRIA COM FOTO E NOME
    if (field === 'conta_id') {
      const conta = contas.find((c) => String(c.id) === String(val));
      if (conta) {
        return (
          <div className="flex items-center gap-2.5 font-sans">
            <div className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm shrink-0">
              <BankAvatar
                logoUrl={conta.logo_url}
                bankName={conta.banco}
                accountName={conta.nome}
                integrationType={conta.tipo_integracao}
                size="sm"
                className="h-5 w-5"
                imageClassName="rounded-sm"
                fallbackClassName="rounded-sm border-0 shadow-none"
              />
            </div>
            <div className="flex flex-col min-w-0 text-left">
              <span className="font-bold text-xs truncate text-slate-800 dark:text-slate-100">{conta.nome}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {conta.banco ? `${conta.banco} · ` : ''}ID #{conta.id}
              </span>
            </div>
          </div>
        );
      }
      return <span className="font-sans font-medium">Conta #{val}</span>;
    }

    // 2. CATEGORIA / PLANO DE CONTAS
    if (field === 'plano_contas_id' || field === 'categoria_id') {
      const cat = planoContas.find((c) => String(c.id) === String(val));
      if (cat) {
        return (
          <div className="flex flex-col min-w-0 font-sans text-left">
            <span className="font-semibold text-xs truncate text-slate-800 dark:text-slate-100">{cat.nome}</span>
            {cat.codigo && <span className="text-[10px] text-slate-400 font-mono">{cat.codigo}</span>}
          </div>
        );
      }
      return <span className="font-sans">Categoria #{val}</span>;
    }

    // 3. CLIENTE / FORNECEDOR
    if (field === 'entidade_id') {
      const ent = entidades.find((e) => String(e.id) === String(val));
      if (ent) {
        const nome = ent.nome || ent.nome_razao_social || ent.razao_social || ent.nome_fantasia;
        return <span className="font-sans font-semibold text-xs text-slate-800 dark:text-slate-100 truncate">{nome}</span>;
      }
      return <span className="font-sans">Interessado #{val}</span>;
    }

    // 4. CENTRO DE CUSTO
    if (field === 'centro_custo_id') {
      const cc = centrosCusto.find((c) => String(c.id) === String(val));
      if (cc) {
        return <span className="font-sans font-semibold text-xs text-slate-800 dark:text-slate-100 truncate">{cc.nome}</span>;
      }
      return <span className="font-sans">Centro #{val}</span>;
    }

    // 5. VALOR MONETÁRIO
    if (field.includes('valor')) {
      return <span className="font-sans font-bold text-xs">{formatMoney(val)}</span>;
    }

    // 6. DATA
    if (field.includes('data') || field === 'created_at' || field === 'updated_at') {
      return <span className="font-sans font-medium text-xs">{formatDate(val)}</span>;
    }

    // 7. STATUS
    if (field === 'status') {
      const s = String(val).toUpperCase();
      const isSuccess = s === 'PAGO' || s === 'CONCILIADO' || s === 'ATIVO';
      const isWarn = s === 'EM ABERTO' || s === 'PENDENTE' || s === 'ABERTO';
      return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-sans uppercase tracking-wider ${
          isSuccess ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
          isWarn ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
        }`}>
          {s}
        </span>
      );
    }

    return <span className="font-sans text-xs">{String(val)}</span>;
  };

  const renderGenericTableDiff = (hideLinkedLancamentoCard = false) => {
    const lancamentoVinculado = snapshot?.lancamento;

    return (
      <div className="space-y-5">
        {/* CARD DO LANÇAMENTO VINCULADO (SE HOUVER E NÃO ESTIVER NO FORMULÁRIO LATERAL) */}
        {!hideLinkedLancamentoCard && lancamentoVinculado && (
          <div className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-sm shrink-0">
                <Receipt className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-xs text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">
                    Lançamento Vinculado #{lancamentoVinculado.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${
                      lancamentoVinculado.tipo === 'RECEITA'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                    }`}
                  >
                    {lancamentoVinculado.tipo}
                  </span>
                  {lancamentoVinculado.status && (
                    <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {lancamentoVinculado.status}
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate mt-1">
                  {lancamentoVinculado.descricao || 'Sem descrição'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {lancamentoVinculado.entidade_nome && (
                    <span>
                      Interessado: <strong className="text-slate-700 dark:text-slate-200">{lancamentoVinculado.entidade_nome}</strong>
                    </span>
                  )}
                  {lancamentoVinculado.conta_nome && (
                    <span>
                      Conta: <strong className="text-slate-700 dark:text-slate-200">{lancamentoVinculado.conta_nome}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Valor Previsto</span>
              <span className="text-base font-black text-slate-900 dark:text-white">
                {formatMoney(lancamentoVinculado.valor_previsto)}
              </span>
            </div>
          </div>
        )}

        {/* ALERTA DE EXCLUSÃO */}
        {isDelete && (
          <div className="bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-3 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>
              Registro excluído do sistema. Abaixo constam todos os valores que estavam cadastrados no momento da exclusão.
            </span>
          </div>
        )}

        {/* ALERTA DE CRIAÇÃO */}
        {isCreate && (
          <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>
              Registro inserido no sistema. Abaixo constam todos os dados gravados no cadastro.
            </span>
          </div>
        )}

        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400 uppercase font-bold text-left">
                <th className="py-2.5 px-3">Campo</th>
                <th className="py-2.5 px-3">Valor Anterior (Antes)</th>
                <th className="py-2.5 px-3">Valor Atualizado (Depois)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {Object.keys(rawChanges).length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-400 italic font-sans">
                    Nenhuma alteração de campos registrada.
                  </td>
                </tr>
              ) : (
                Object.entries(rawChanges).map(([field, change]: [string, any]) => (
                  <tr key={field} className="hover:bg-slate-100/50 dark:hover:bg-slate-800/60">
                    <td className="py-3 px-3 font-bold font-sans text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {getFieldFriendlyName(field)}
                    </td>
                    <td className="py-3 px-3 text-rose-700 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/20">
                      {change.old !== undefined && change.old !== null
                        ? renderFormattedDiffValue(field, change.old, 'old')
                        : <span className="text-slate-400 italic font-sans">—</span>}
                    </td>
                    <td className="py-3 px-3 text-emerald-700 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/20 font-semibold">
                      {change.new !== undefined && change.new !== null
                        ? renderFormattedDiffValue(field, change.new, 'new')
                        : isDelete
                        ? <span className="text-rose-500 font-bold italic font-sans">— (Excluído)</span>
                        : <span className="text-slate-400 italic font-sans">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Largura do drawer: se for Lado a Lado ou se tiver Lançamento Vinculado com Extrato/Baixa, expande a largura da gaveta
  const hasLinkedLancamento = Boolean(snapshot?.lancamento);
  const isWide = (isUpdate && (isLancamento || isBaixa) && viewMode === 'both') || hasLinkedLancamento;

  const drawerWidthClass = isWide
    ? 'w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl'
    : 'w-full max-w-2xl';

  return (
    <div className="fixed inset-0 z-[200] flex justify-end overflow-hidden">
      {/* BACKDROP ESCURO DIMINUINDO O BRILHO DE TRÁS IDÊNTICO AO LANCAMENTO FORM DRAWER */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* PAINEL DRAWER LATERAL COBRINDO A TELA INTEIRA DE CIMA A BAIXO */}
      <div
        className={`relative z-10 h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-700 animate-slide-in-right overflow-hidden ${drawerWidthClass}`}
      >
        {/* HEADER DO DRAWER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`p-1.5 rounded-lg ${
                  isCreate
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                    : isDelete
                    ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                    : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400'
                }`}
              >
                {isCreate ? <PlusCircle className="w-5 h-5" /> : isDelete ? <Trash2 className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
              </span>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                {isLancamento
                  ? isCreate
                    ? `Lançamento Criado — #${log.record_id || log.id}`
                    : isDelete
                    ? `Lançamento Excluído — #${log.record_id || log.id}`
                    : `Comparativo de Alteração — Lançamento #${log.record_id || log.id}`
                  : isBaixa
                  ? isCreate
                    ? `Pagamento / Baixa Registrada — #${log.record_id || log.id}`
                    : isDelete
                    ? `Baixa Excluída — #${log.record_id || log.id}`
                    : `Comparativo de Alteração — Baixa #${log.record_id || log.id}`
                  : isMovimento
                  ? isCreate
                    ? `Movimentação Bancária Registrada — #${log.record_id || log.id}`
                    : isDelete
                    ? `Extrato Bancário Excluído — #${log.record_id || log.id}`
                    : `Comparativo de Alteração — Extrato #${log.record_id || log.id}`
                  : `Auditoria — ${log.friendly_table_name || log.table_name} #${log.record_id || log.id}`}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <strong>Operador:</strong> {log.user_email || 'Sistema'}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <strong>Data/Hora:</strong> {new Date(log.created_at).toLocaleString('pt-BR')}
              </span>
              {log.undone && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  Ação Desfeita
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* SELETOR DE MODO DE VISUALIZAÇÃO PARA ALTERAÇÕES */}
            {isUpdate && (isLancamento || isBaixa) && (
              <div className="hidden sm:flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('both')}
                  className={`px-3 py-1 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'both'
                      ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                  title="Visualizar lado a lado"
                >
                  <Columns className="w-3.5 h-3.5" />
                  Lado a Lado
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('after')}
                  className={`px-3 py-1 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'after'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                  title="Ver formulário com valores atualizados"
                >
                  Depois (Atualizado)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('before')}
                  className={`px-3 py-1 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'before'
                      ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                  title="Ver formulário com valores anteriores"
                >
                  Antes
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400 outline-none transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* CORPO DO DRAWER COM SCROLL INTERNO */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
          {loadingSnapshot ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-sm font-semibold">Carregando dados completos do formulário...</p>
            </div>
          ) : isLancamento ? (
            <>
              {isCreate && (
                <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>
                    Formulário idêntico ao de lançamentos em modo somente leitura com os dados cadastrados nesta operação.
                  </span>
                </div>
              )}

              {isDelete && (
                <div className="bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-3 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>
                    Formulário idêntico ao de lançamentos exibindo o estado exato no momento imediatamente anterior à exclusão.
                  </span>
                </div>
              )}

              {isUpdate && (
                <div className="bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-500" />
                  <span>
                    Formulário idêntico com dados completos. Os campos destacados indicam as propriedades modificadas nesta alteração.
                  </span>
                </div>
              )}

              {isUpdate ? (
                viewMode === 'both' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-full overflow-hidden">
                    <div className="min-w-0 w-full overflow-hidden">
                      {renderLancamentoForm('old', 'Valores Anteriores (Antes)')}
                    </div>
                    <div className="min-w-0 w-full overflow-hidden">
                      {renderLancamentoForm('new', 'Valores Atualizados (Depois)')}
                    </div>
                  </div>
                ) : viewMode === 'after' ? (
                  <div className="w-full max-w-xl mx-auto overflow-hidden">
                    {renderLancamentoForm('new', 'Valores Atualizados (Depois)')}
                  </div>
                ) : (
                  <div className="w-full max-w-xl mx-auto overflow-hidden">
                    {renderLancamentoForm('old', 'Valores Anteriores (Antes)')}
                  </div>
                )
              ) : isCreate ? (
                <div className="w-full max-w-xl mx-auto overflow-hidden">
                  {renderLancamentoForm('new', 'Dados do Lançamento Criado')}
                </div>
              ) : (
                <div className="w-full max-w-xl mx-auto overflow-hidden">
                  {renderLancamentoForm('old', 'Dados do Lançamento Excluído')}
                </div>
              )}
            </>
          ) : isBaixa ? (
            <>
              {isCreate && (
                <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>
                    Visualização somente leitura de todos os dados do pagamento / baixa registrada no sistema.
                  </span>
                </div>
              )}

              {isDelete && (
                <div className="bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-3 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>
                    Visualização somente leitura de todos os dados da baixa no estado exato em que se encontrava antes de ser excluída.
                  </span>
                </div>
              )}

              {isUpdate && (
                <div className="bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-500" />
                  <span>
                    Formulário completo da baixa. Os campos destacados indicam as propriedades modificadas nesta alteração.
                  </span>
                </div>
              )}

              {isUpdate ? (
                viewMode === 'both' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-full overflow-hidden">
                    <div className="min-w-0 w-full overflow-hidden">
                      {renderBaixaForm('old', 'Valores Anteriores (Antes)')}
                    </div>
                    <div className="min-w-0 w-full overflow-hidden">
                      {renderBaixaForm('new', 'Valores Atualizados (Depois)')}
                    </div>
                  </div>
                ) : viewMode === 'after' ? (
                  <div className="w-full max-w-xl mx-auto overflow-hidden">
                    {renderBaixaForm('new', 'Valores Atualizados (Depois)')}
                  </div>
                ) : (
                  <div className="w-full max-w-xl mx-auto overflow-hidden">
                    {renderBaixaForm('old', 'Valores Anteriores (Antes)')}
                  </div>
                )
              ) : isCreate ? (
                hasLinkedLancamento ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-full overflow-hidden items-start">
                    <div className="min-w-0 w-full overflow-hidden space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                        <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                          <Receipt className="w-4 h-4" />
                          Lançamento Financeiro Vinculado
                        </span>
                        <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">
                          #{snapshot.lancamento.id}
                        </span>
                      </div>
                      {renderLancamentoForm('new', `Lançamento #${snapshot.lancamento.id}`, snapshot.lancamento)}
                    </div>
                    <div className="min-w-0 w-full overflow-hidden space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                        <span>Dados do Pagamento / Baixa</span>
                        <span className="font-mono text-slate-400">#{log.record_id || log.id}</span>
                      </div>
                      {renderBaixaForm('new', 'Dados do Pagamento / Baixa Cadastrada')}
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-xl mx-auto overflow-hidden">
                    {renderBaixaForm('new', 'Dados do Pagamento / Baixa Cadastrada')}
                  </div>
                )
              ) : (
                hasLinkedLancamento ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-full overflow-hidden items-start">
                    <div className="min-w-0 w-full overflow-hidden space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                        <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                          <Receipt className="w-4 h-4" />
                          Lançamento Financeiro Vinculado
                        </span>
                        <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">
                          #{snapshot.lancamento.id}
                        </span>
                      </div>
                      {renderLancamentoForm('new', `Lançamento #${snapshot.lancamento.id}`, snapshot.lancamento)}
                    </div>
                    <div className="min-w-0 w-full overflow-hidden space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                        <span>Dados da Baixa Excluída</span>
                        <span className="font-mono text-slate-400">#{log.record_id || log.id}</span>
                      </div>
                      {renderBaixaForm('old', 'Dados da Baixa Excluída')}
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-xl mx-auto overflow-hidden">
                    {renderBaixaForm('old', 'Dados da Baixa Excluída')}
                  </div>
                )
              )}
            </>
          ) : (
            hasLinkedLancamento ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-full overflow-hidden items-start">
                {/* LADO ESQUERDO: TODAS AS INFORMAÇÕES DO LANÇAMENTO IDÊNTICAS AO FORMULÁRIO DE LANÇAMENTOS */}
                <div className="min-w-0 w-full overflow-hidden space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                    <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                      <Receipt className="w-4 h-4" />
                      Lançamento Financeiro Vinculado
                    </span>
                    <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">
                      #{snapshot.lancamento.id}
                    </span>
                  </div>
                  {renderLancamentoForm('new', `Lançamento #${snapshot.lancamento.id}`, snapshot.lancamento)}
                </div>

                {/* LADO DIREITO: EXTRATO BANCÁRIO / AUDITORIA */}
                <div className="min-w-0 w-full overflow-hidden space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                    <span>Auditoria do Extrato Bancário</span>
                    <span className="font-mono text-slate-400">#{log.record_id || log.id}</span>
                  </div>
                  {renderGenericTableDiff(true)}
                </div>
              </div>
            ) : (
              <div className="w-full max-w-2xl mx-auto overflow-hidden">
                {renderGenericTableDiff(false)}
              </div>
            )
          )}
        </div>

        {/* FOOTER FIXO DO DRAWER */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0">
          <div className="text-xs text-slate-400">
            {isLancamento
              ? isUpdate
                ? `${changedFields.size} campo(s) modificado(s) nesta operação.`
                : isCreate
                ? 'Lançamento inserido no sistema.'
                : 'Lançamento removido do sistema.'
              : isBaixa
              ? isUpdate
                ? `${changedFields.size} campo(s) modificado(s) nesta baixa.`
                : isCreate
                ? 'Pagamento / Baixa registrada no sistema.'
                : 'Baixa removida do sistema.'
              : isMovimento
              ? isUpdate
                ? `${changedFields.size} campo(s) modificado(s) no extrato.`
                : isCreate
                ? 'Movimentação bancária registrada no extrato.'
                : 'Extrato bancário removido do sistema.'
              : `${Object.keys(rawChanges).length} campo(s) registrado(s).`}
          </div>

          <div className="flex items-center gap-3">
            {log.is_undoable && !log.undone && onUndo && (
              <button
                type="button"
                onClick={() => onUndo(log.id)}
                disabled={isUndoLoading}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition shadow-sm cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                {isUndoLoading ? 'Desfazendo...' : 'Desfazer Ação'}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

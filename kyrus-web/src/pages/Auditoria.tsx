import { useEffect, useMemo, useState } from 'react';
import { api, normalizeListResponse } from '../services/api';
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Undo2,
  Redo2,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  X,
  ArrowRightLeft,
  Trash2,
  Plus,
  Clock,
  BarChart3,
  Database,
  Key,
  FileText,
  AlertTriangle
} from 'lucide-react';

interface AuditLogItem {
  id: number;
  friendly_table_name: string;
  friendly_action: string;
  friendly_details: string[];
  user_email?: string;
  created_at: string;
  undone?: boolean;
  is_undoable: boolean;
  batch_id?: string;
}

interface AlertaItem {
  id: number;
  tipo_objeto: string;
  objeto_id: number;
  tipo_anomalia: string;
  gravidade: string;
  descricao: string;
  status: string;
  dados_extras?: any;
  resolvido_em?: string;
  resolvido_por_id?: number;
  motivo_resolucao?: string;
  created_at: string;
}

interface SilencingRuleItem {
  id: number;
  tipo_anomalia: string;
  plano_contas_id?: number;
  entidade_id?: number;
  valor_limite?: number;
  created_at: string;
}

const formatDateTime = (iso: string) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
};

const ANOMALY_TRANSLATIONS: Record<string, string> = {
  DUPLICIDADE_OFX: 'Movimento OFX Duplicado',
  PAGAMENTO_DUPLO: 'Pagamento Duplo Realizado',
  VALOR_ATIPICO: 'Desvio de Valor Atípico',
  EXCLUSAO_SUSPEITA: 'Exclusão Suspeita de Lançamento',
  DESVIO_PLANO_CONTAS: 'Desvio de Plano de Contas',
  HORARIO_ATIPICO: 'Operação em Horário Atípico',
  CONTA_DIVERGENTE: 'Divergência de Conta Bancária',
  LANCAMENTO_SEM_COMPROVANTE: 'Lançamento sem Comprovante',
  LOGIN_BRUTE_FORCE: 'Força Bruta no Login',
  ALTERACAO_DADOS_BANCARIOS: 'Alteração de Dados Bancários',
  SILENCIAMENTO_SUSPEITO: 'Silenciamento Suspeito',
};

const GRAVITY_CLASSES: Record<string, string> = {
  CRITICA: 'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  ALTA: 'bg-orange-50 text-orange-700 dark:bg-orange-950/20 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  MEDIA: 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  BAIXA: 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

export function Auditoria() {
  const [currentTab, setCurrentTab] = useState<'alertas' | 'logs' | 'lotes'>('alertas');
  const [loading, setLoading] = useState(true);

  // TOAST STATES
  interface ToastItem {
    id: number;
    type: 'success' | 'error' | 'info';
    message: string;
  }
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // --- TAB 1: AUDIT LOGS STATE ---
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [tableName, setTableName] = useState('');
  const [action, setAction] = useState('');
  const [userId] = useState('');
  const [q, setQ] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});

  // --- TAB 2: ANOMALY ALERTS STATE ---
  const [alerts, setAlerts] = useState<AlertaItem[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(0);
  const [alertsLimit, setAlertsLimit] = useState(50);
  const [alertsStatusFilter, setAlertsStatusFilter] = useState('PENDENTE');
  const [alertsGravityFilter, setAlertsGravityFilter] = useState('');
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [motivoResolucao, setMotivoResolucao] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [quickAction, setQuickAction] = useState<'excluir_movimento_duplicado' | 'restaurar_lancamento' | null>(null);
  const [submittingResolucao, setSubmittingResolucao] = useState(false);

  // --- TAB 3: BATCHES STATE ---
  const [batches, setBatches] = useState<any[]>([]);
  const [undoingBatchId, setUndoingBatchId] = useState<string | null>(null);
  const [ocultarAutomaticos, setOcultarAutomaticos] = useState(true);

  // --- COMPLIANCE DETAILS MODALS ---
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  // selectedLancamentoId hook removed

  // --- INTEGRITY STATUS ---
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<{ checked: boolean; integro?: boolean; mensagem?: string; quebras?: any[] }>({ checked: false });

  // --- SILENCING RULES MODAL ---
  const [silencingModalOpen, setSilencingModalOpen] = useState(false);
  const [silencingRules, setSilencingRules] = useState<SilencingRuleItem[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [newRule, setNewRule] = useState({
    tipo_anomalia: 'VALOR_ATIPICO',
    plano_contas_id: '',
    entidade_id: '',
    valor_limite: ''
  });

  // --- BATCH PREVIEW MODAL ---
  const [batchPreviewModalOpen, setBatchPreviewModalOpen] = useState(false);
  // batchPreviewId hook removed
  const [batchPreviewData, setBatchPreviewData] = useState<any[]>([]);
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false);

  // --- ACTIONS ON LOGS ---
  async function handleUndo(logId: number) {
    setActionLoading(prev => ({ ...prev, [logId]: true }));
    try {
      await api.post(`/auditoria/${logId}/undo`);
      pushToast('success', 'Ação desfeita com sucesso!');
      setItems(prev => prev.map(item => item.id === logId ? { ...item, undone: true } : item));
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.detail || 'Erro ao desfazer ação';
      pushToast('error', errorMsg);
    } finally {
      setActionLoading(prev => ({ ...prev, [logId]: false }));
    }
  }

  async function handleRedo(logId: number) {
    setActionLoading(prev => ({ ...prev, [logId]: true }));
    try {
      await api.post(`/auditoria/${logId}/redo`);
      pushToast('success', 'Ação refeita com sucesso!');
      setItems(prev => prev.map(item => item.id === logId ? { ...item, undone: false } : item));
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.detail || 'Erro ao refazer ação';
      pushToast('error', errorMsg);
    } finally {
      setActionLoading(prev => ({ ...prev, [logId]: false }));
    }
  }

  // --- ACTIONS ON ALERTS ---
  async function handleIgnoreAlert(alertId: number) {
    if (!confirm('Deseja realmente ignorar este alerta de segurança?')) return;
    try {
      await api.post(`/auditoria/alertas/${alertId}/ignorar`);
      pushToast('success', 'Alerta ignorado com sucesso');
      loadAlerts(true);
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.detail || 'Erro ao ignorar alerta';
      pushToast('error', errorMsg);
    }
  }

  async function handleResolveAlertSubmit() {
    if (!resolvingId) return;
    setSubmittingResolucao(true);
    try {
      if (quickAction) {
        // Resolução rápida (Excluir movimento duplicado ou Restaurar lançamento)
        await api.post(`/auditoria/alertas/${resolvingId}/quick-resolve`, {
          action: quickAction,
          password_confirm: passwordConfirm || undefined
        });
      } else {
        // Resolução padrão com justificativa em texto
        await api.post(`/auditoria/alertas/${resolvingId}/resolver`, {
          observacoes: motivoResolucao.trim(),
          password_confirm: passwordConfirm || undefined
        });
      }
      pushToast('success', 'Alerta resolvido com sucesso');
      setResolvingId(null);
      setMotivoResolucao('');
      setPasswordConfirm('');
      setQuickAction(null);
      loadAlerts(true);
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.detail || 'Erro ao resolver alerta';
      pushToast('error', errorMsg);
    } finally {
      setSubmittingResolucao(false);
    }
  }

  // --- TIMELINE LOADING ---
  async function loadTimeline(lancamentoId: number) {
    setTimelineOpen(true);
    setTimelineLoading(true);
    try {
      const { data } = await api.get(`/auditoria/lancamento/${lancamentoId}/timeline`);
      setTimelineData(data.timeline || []);
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao carregar linha do tempo operacional');
    } finally {
      setTimelineLoading(false);
    }
  }

  // --- INTEGRITY CHECKING ---
  async function verifyIntegrity() {
    setIntegrityLoading(true);
    try {
      const { data } = await api.get('/auditoria/verificar-integridade');
      setIntegrityResult({
        checked: true,
        integro: data.integro,
        mensagem: data.mensagem,
        quebras: data.quebras
      });
      if (data.integro) {
        pushToast('success', 'Verificação concluída: Logs de auditoria íntegros!');
      } else {
        pushToast('error', 'Aviso: Inconsistência na cadeia de logs detectada!');
      }
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao processar verificação de integridade');
    } finally {
      setIntegrityLoading(false);
    }
  }

  // --- SILENCING RULES ---
  async function loadSilencingRules() {
    try {
      const { data } = await api.get('/auditoria/silenciamento');
      setSilencingRules(normalizeListResponse<SilencingRuleItem>(data));
    } catch (e) {
      console.error('Erro ao carregar regras de silenciamento', e);
    }
  }

  async function loadCategoriesAndEntities() {
    try {
      const catRes = await api.get('/plano-contas/');
      const entRes = await api.get('/entidades/lookup');
      setCategories(normalizeListResponse<any>(catRes.data));
      setEntities(normalizeListResponse<any>(entRes.data));
    } catch (e) {
      console.error('Erro ao carregar categorias/entidades', e);
    }
  }

  async function createSilencingRule() {
    try {
      await api.post('/auditoria/silenciamento', {
        tipo_anomalia: newRule.tipo_anomalia,
        plano_contas_id: newRule.plano_contas_id ? Number(newRule.plano_contas_id) : undefined,
        entidade_id: newRule.entidade_id ? Number(newRule.entidade_id) : undefined,
        valor_limite: newRule.valor_limite ? Number(newRule.valor_limite) : undefined
      });
      pushToast('success', 'Regra de silenciamento cadastrada!');
      setNewRule({ tipo_anomalia: 'VALOR_ATIPICO', plano_contas_id: '', entidade_id: '', valor_limite: '' });
      loadSilencingRules();
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.detail || 'Erro ao cadastrar regra';
      pushToast('error', errorMsg);
    }
  }

  async function deleteSilencingRule(id: number) {
    if (!confirm('Deseja realmente remover esta regra de silenciamento?')) return;
    try {
      await api.delete(`/auditoria/silenciamento/${id}`);
      pushToast('success', 'Regra removida com sucesso');
      loadSilencingRules();
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao remover regra');
    }
  }

  // --- BATCH PREVIEW ---
  async function loadBatchPreview(batchId: string) {
    setBatchPreviewModalOpen(true);
    setBatchPreviewLoading(true);
    try {
      const { data } = await api.post('/auditoria/batch/preview', { batch_id: batchId });
      setBatchPreviewData(data.items || []);
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao carregar preview do lote');
    } finally {
      setBatchPreviewLoading(false);
    }
  }

  // --- EXPORT ALERTS ---
  async function exportAlertsCsv() {
    try {
      const response = await api.get('/auditoria/alertas/exportar', {
        params: {
          status: alertsStatusFilter || undefined,
          gravidade: alertsGravityFilter || undefined
        },
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `relatorio_auditoria_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      pushToast('success', 'Relatório exportado com sucesso');
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao exportar relatório');
    }
  }

  // --- DATA LOADING ---
  async function loadAuditoria(silent: boolean = false) {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/auditoria/', {
        params: {
          skip: page * limit,
          limit,
          table_name: tableName || undefined,
          action: action || undefined,
          user_id: userId || undefined,
          q: q || undefined,
          start: start || undefined,
          end: end || undefined,
          incluir_automaticos: !ocultarAutomaticos
        }
      });
      const items = normalizeListResponse<AuditLogItem>(data.items ?? data);
      setItems(items);
      setTotal(Number(data?.total ?? items.length ?? 0));
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao carregar log de auditoria');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadAlerts(silent: boolean = false) {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/auditoria/alertas', {
        params: {
          skip: alertsPage * alertsLimit,
          limit: alertsLimit,
          status: alertsStatusFilter || undefined,
          gravidade: alertsGravityFilter || undefined,
        }
      });
      const items = normalizeListResponse<AlertaItem>(data.items ?? data);
      setAlerts(items);
      setAlertsTotal(Number(data?.total ?? items.length ?? 0));
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao carregar alertas de anomalia');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadBatches(silent: boolean = false) {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/auditoria/batches');
      const items = normalizeListResponse<any>(data.items ?? data);
      setBatches(items);
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao carregar lotes de importação');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function handleUndoBatch(batchId: string) {
    if (!confirm('Deseja realmente desfazer todas as alterações deste lote de importação? Esta ação não pode ser desfeita.')) return;
    setUndoingBatchId(batchId);
    try {
      await api.post('/auditoria/batch/undo', { batch_id: batchId });
      pushToast('success', 'Lote de importação desfeito com sucesso!');
      loadBatches(true);
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.detail || 'Erro ao desfazer lote de importação';
      pushToast('error', errorMsg);
    } finally {
      setUndoingBatchId(null);
    }
  }

  const parseBatchId = (batchId: string) => {
    if (!batchId) return { type: 'Outro', filename: '-', info: '' };
    if (batchId.startsWith('OFX:')) {
      const parts = batchId.split(':');
      if (parts.length >= 2) {
        return {
          type: 'OFX',
          filename: parts[1],
          info: parts.slice(2).join(':')
        };
      }
    }
    return {
      type: 'Outro',
      filename: batchId,
      info: ''
    };
  };

  useEffect(() => {
    if (currentTab === 'logs') {
      const id = setTimeout(() => {
        loadAuditoria();
      }, 400);
      return () => clearTimeout(id);
    }
  }, [page, limit, tableName, action, userId, q, start, end, currentTab, ocultarAutomaticos]);

  useEffect(() => {
    if (currentTab === 'lotes') {
      loadBatches();
    }
  }, [currentTab]);

  useEffect(() => {
    if (currentTab === 'alertas') {
      const id = setTimeout(() => {
        loadAlerts();
      }, 400);
      return () => clearTimeout(id);
    }
  }, [alertsPage, alertsLimit, alertsStatusFilter, alertsGravityFilter, currentTab]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const totalAlertPages = useMemo(() => Math.max(1, Math.ceil(alertsTotal / alertsLimit)), [alertsTotal, alertsLimit]);

  // --- STATS DYNAMICS FOR DASHBOARD KPIs ---
  const stats = useMemo(() => {
    const totalCount = alerts.length;
    const pendentes = alerts.filter(a => a.status === 'PENDENTE').length;
    const criticos = alerts.filter(a => a.gravidade === 'CRITICA' || a.gravidade === 'ALTA').length;
    const resolvidos = alerts.filter(a => a.status === 'RESOLVIDO').length;
    
    // Bar chart frequencies by severity
    const counts: Record<string, number> = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAIXA: 0 };
    alerts.forEach(a => {
      if (counts[a.gravidade] !== undefined) counts[a.gravidade]++;
    });
    
    return { totalCount, pendentes, criticos, resolvidos, counts };
  }, [alerts]);

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resolvingAlert = useMemo(() => {
    return alerts.find(a => a.id === resolvingId) || null;
  }, [resolvingId, alerts]);

  const requiresPasswordConfirm = useMemo(() => {
    return resolvingAlert?.gravidade === 'CRITICA' || resolvingAlert?.gravidade === 'ALTA';
  }, [resolvingAlert]);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-500" />
            Auditoria e Segurança Financeira
          </h2>
          <p className="text-sm text-slate-400">Audite eventos operacionais e acompanhe alertas de anomalias com IA.</p>
        </div>

        <div className="flex items-center gap-3">
          {/* TAB SELECTOR */}
          <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => { setCurrentTab('alertas'); setLoading(true); }}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                currentTab === 'alertas'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Alertas de Segurança
            </button>
            <button
              onClick={() => { setCurrentTab('logs'); setLoading(true); }}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                currentTab === 'logs'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              Logs de Operações
            </button>
            <button
              onClick={() => { setCurrentTab('lotes'); setLoading(true); }}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                currentTab === 'lotes'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Lotes de Importação
            </button>
          </div>

          <button
            onClick={() => {
              setSilencingModalOpen(true);
              loadSilencingRules();
              loadCategoriesAndEntities();
            }}
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            Silenciamento
          </button>

          <button
            onClick={() => currentTab === 'alertas' ? loadAlerts() : currentTab === 'logs' ? loadAuditoria() : loadBatches()}
            className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition"
            title="Atualizar"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="p-6 space-y-4 flex-1 overflow-y-auto">
        {/* ========================================================
            TAB: ALERTA DE ANOMALIAS
           ======================================================== */}
        {currentTab === 'alertas' && (
          <div className="space-y-4">
            
            {/* KPI DASHBOARD CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex items-center gap-4">
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Alertas Pendentes</p>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-0.5">{stats.pendentes}</h3>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex items-center gap-4">
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Críticos / Altos</p>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-0.5">{stats.criticos}</h3>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex items-center gap-4">
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Casos Resolvidos</p>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-0.5">{stats.resolvidos}</h3>
                </div>
              </div>

              {/* DYNAMIC PURE-CSS BAR CHART FOR SEVERITY COUNTS */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex flex-col justify-center gap-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" /> Frequência de Severidade
                </p>
                <div className="flex items-end justify-between h-10 px-2 gap-1.5">
                  {Object.entries(stats.counts).map(([sev, val]) => {
                    const maxVal = Math.max(...Object.values(stats.counts), 1);
                    const pct = (val / maxVal) * 100;
                    const barColor = 
                      sev === 'CRITICA' ? 'bg-rose-500' :
                      sev === 'ALTA' ? 'bg-orange-500' :
                      sev === 'MEDIA' ? 'bg-amber-500' : 'bg-slate-400';
                    return (
                      <div key={sev} className="flex-1 flex flex-col items-center group relative cursor-pointer">
                        <div className="absolute bottom-full mb-1 bg-slate-900 text-white text-[9px] px-1 rounded opacity-0 group-hover:opacity-100 transition duration-150">
                          {val}
                        </div>
                        <div className={`w-full ${barColor} rounded-t`} style={{ height: `${Math.max(pct, 12)}%` }} />
                        <span className="text-[9px] font-bold text-slate-400 mt-1">{sev.slice(0, 3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* FILTERS & EXPORT */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1 min-w-[150px]">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status do Alerta</label>
                  <select
                    value={alertsStatusFilter}
                    onChange={(e) => { setAlertsPage(0); setAlertsStatusFilter(e.target.value); }}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                  >
                    <option value="">Todos</option>
                    <option value="PENDENTE">Pendentes</option>
                    <option value="RESOLVIDO">Resolvidos</option>
                    <option value="IGNORADO">Ignorados</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[150px]">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gravidade</label>
                  <select
                    value={alertsGravityFilter}
                    onChange={(e) => { setAlertsPage(0); setAlertsGravityFilter(e.target.value); }}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                  >
                    <option value="">Todas</option>
                    <option value="CRITICA">Crítica</option>
                    <option value="ALTA">Alta</option>
                    <option value="MEDIA">Média</option>
                    <option value="BAIXA">Baixa</option>
                  </select>
                </div>
              </div>

              <button
                onClick={exportAlertsCsv}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition flex items-center gap-1.5 self-end"
              >
                <FileText className="w-3.5 h-3.5" />
                Exportar CSV
              </button>
            </div>

            {/* TABLE */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 text-left">Gravidade</th>
                    <th className="py-3 px-4 text-left">Tipo de Anomalia</th>
                    <th className="py-3 px-4 text-left">Descrição</th>
                    <th className="py-3 px-4 text-left">Data</th>
                    <th className="py-3 px-4 text-left">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {loading ? (
                    <tr><td colSpan={6} className="py-12 text-center text-slate-400">Carregando alertas...</td></tr>
                  ) : alerts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                          <p className="font-semibold text-slate-700 dark:text-slate-300">Tudo limpo por aqui!</p>
                          <p className="text-xs text-slate-400">Nenhuma anomalia financeira ou suspeita detectada no período.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    alerts.map((alerta) => (
                      <tr key={alerta.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="py-4 px-4">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${GRAVITY_CLASSES[alerta.gravidade] || 'bg-slate-100'}`}>
                            {alerta.gravidade}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-semibold text-slate-700 dark:text-slate-200">
                          {ANOMALY_TRANSLATIONS[alerta.tipo_anomalia] || alerta.tipo_anomalia}
                        </td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                          <div>
                            <p>{alerta.descricao}</p>
                            {alerta.motivo_resolucao && (
                              <p className="mt-1 text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 p-2 rounded-lg border border-indigo-100 dark:border-indigo-900/60 font-mono">
                                <strong>Resolução:</strong> {alerta.motivo_resolucao}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-slate-400 text-xs font-mono">
                          {formatDateTime(alerta.created_at)}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`px-2 py-0.5 text-xs rounded-lg font-bold ${
                            alerta.status === 'PENDENTE'
                              ? 'bg-amber-100/70 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200/55'
                              : alerta.status === 'RESOLVIDO'
                              ? 'bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-200/55'
                              : 'bg-slate-100/70 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {alerta.status}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end items-center gap-1.5">
                            {/* TIMELINE TRIGGER FOR LANCAMENTOS */}
                            {alerta.tipo_objeto === 'lancamento' && (
                              <button
                                onClick={() => loadTimeline(alerta.objeto_id)}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition flex items-center gap-1"
                              >
                                <Clock className="w-3 h-3" />
                                Timeline
                              </button>
                            )}

                            {alerta.status === 'PENDENTE' && (
                              <>
                                {/* QUICK RESOLVE TRIGGERS */}
                                {alerta.tipo_anomalia === 'DUPLICIDADE_OFX' && (
                                  <button
                                    onClick={() => {
                                      setResolvingId(alerta.id);
                                      setQuickAction('excluir_movimento_duplicado');
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                                  >
                                    Excluir Duplicado
                                  </button>
                                )}

                                {alerta.tipo_anomalia === 'EXCLUSAO_SUSPEITA' && (
                                  <button
                                    onClick={() => {
                                      setResolvingId(alerta.id);
                                      setQuickAction('restaurar_lancamento');
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition"
                                  >
                                    Restaurar
                                  </button>
                                )}

                                <button
                                  onClick={() => setResolvingId(alerta.id)}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
                                >
                                  Resolver
                                </button>
                                <button
                                  onClick={() => handleIgnoreAlert(alerta.id)}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition"
                                >
                                  Ignorar
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400">Total: {alertsTotal}</div>
              <div className="flex items-center gap-2">
                <select
                  value={alertsLimit}
                  onChange={(e) => { setAlertsPage(0); setAlertsLimit(Number(e.target.value)); }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-100"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button
                  onClick={() => setAlertsPage(p => Math.max(0, p - 1))}
                  disabled={alertsPage === 0}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-100 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-xs text-slate-500">{alertsPage + 1} / {totalAlertPages}</div>
                <button
                  onClick={() => setAlertsPage(p => Math.min(totalAlertPages - 1, p + 1))}
                  disabled={alertsPage + 1 >= totalAlertPages}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-100 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB: LOGS DE AUDITORIA
           ======================================================== */}
        {currentTab === 'logs' && (
          <div className="space-y-4">
            
            {/* INTEGRITY CHECK PANEL */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <Database className="w-6 h-6 text-slate-400" />
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-white">Cadeia Criptográfica de Logs</h4>
                  <p className="text-xs text-slate-400">Verifique a assinatura SHA256 em cadeia que impede a adulteração retroativa dos logs.</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {integrityResult.checked && (
                  <span className={`px-3 py-1 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                    integrityResult.integro 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30'
                  }`}>
                    {integrityResult.integro ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    {integrityResult.integro ? 'Logs Íntegros' : 'Quebra de Cadeia Detectada'}
                  </span>
                )}
                
                <button
                  onClick={verifyIntegrity}
                  disabled={integrityLoading}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition flex items-center gap-1.5"
                >
                  {integrityLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Verificar Integridade
                </button>
              </div>
            </div>

            {/* INTEGRITY DETAILED QUEBRAS PANEL */}
            {integrityResult.checked && !integrityResult.integro && integrityResult.quebras && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/10 rounded-2xl border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 space-y-2">
                <p className="font-bold flex items-center gap-1 text-sm"><AlertTriangle className="w-4 h-4" /> Alerta de Compliance!</p>
                <p className="text-xs">Ocorreram as seguintes quebras de corrente criptográfica na base de logs de auditoria:</p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 mt-2 font-mono text-[11px]">
                  {integrityResult.quebras.map((q, idx) => (
                    <div key={idx} className="p-2 rounded bg-white dark:bg-slate-900 border border-rose-100 dark:border-rose-950/30">
                      <strong>Log ID {q.log_id}:</strong> {q.motivo} <br />
                      <span className="text-slate-400">Esperado:</span> {q.esperado?.slice(0, 16)}... | 
                      <span className="text-slate-400"> Encontrado:</span> {q.encontrado?.slice(0, 16)}...
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FILTERS */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Busca Geral</label>
                <div className="relative">
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => { setPage(0); setQ(e.target.value); }}
                    placeholder="Descrição, valor..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tabela / Módulo</label>
                <select
                  value={tableName}
                  onChange={(e) => { setPage(0); setTableName(e.target.value); }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                >
                  <option value="">Todas</option>
                  <option value="lancamentos">Lançamentos</option>
                  <option value="contas">Contas Bancárias</option>
                  <option value="cartoes">Cartões de Crédito</option>
                  <option value="entidades">Clientes / Fornecedores</option>
                  <option value="usuarios">Usuários</option>
                  <option value="integracoes_bancarias">Integrações</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ação</label>
                <select
                  value={action}
                  onChange={(e) => { setPage(0); setAction(e.target.value); }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                >
                  <option value="">Todas</option>
                  <option value="CREATE">Criação</option>
                  <option value="UPDATE">Alteração</option>
                  <option value="SOFT_DELETE">Arquivamento</option>
                  <option value="RESTORE">Restauração</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Início</label>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => { setPage(0); setStart(e.target.value); }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Fim</label>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => { setPage(0); setEnd(e.target.value); }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
                />
              </div>

              <div className="flex items-center gap-2 mt-4 pt-1">
                <input
                  type="checkbox"
                  id="ocultarAutomaticos"
                  checked={ocultarAutomaticos}
                  onChange={(e) => { setPage(0); setOcultarAutomaticos(e.target.checked); }}
                  className="rounded border-slate-200 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <label htmlFor="ocultarAutomaticos" className="text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                  Ocultar alterações automáticas
                </label>
              </div>
            </div>

            {/* TABLE */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 text-left">Data</th>
                    <th className="py-3 px-4 text-left">Módulo</th>
                    <th className="py-3 px-4 text-left">Operação</th>
                    <th className="py-3 px-4 text-left">Operador</th>
                    <th className="py-3 px-4 text-left">Modificações</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {loading ? (
                    <tr><td colSpan={6} className="py-12 text-center text-slate-400">Carregando logs...</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-slate-400">Nenhum evento registrado.</td></tr>
                  ) : (
                    items.map((item) => {
                      const isRowLoading = actionLoading[item.id] || false;
                      return (
                        <tr key={item.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${item.undone ? 'opacity-65 bg-rose-50/20 dark:bg-rose-950/10' : ''}`}>
                          <td className="py-3 px-4 text-slate-400 text-xs font-mono">
                            {formatDateTime(item.created_at)}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200">
                            {item.friendly_table_name}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-lg ${
                              item.friendly_action === 'Criação' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                              item.friendly_action === 'Alteração' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400' :
                              item.friendly_action === 'Exclusão' || item.friendly_action === 'Arquivamento' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400' :
                              'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                              {item.friendly_action}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-300 text-xs">
                            {item.user_email || 'Sistema'}
                          </td>
                          <td className="py-3 px-4">
                            <button
                              onClick={() => toggleExpanded(item.id)}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40 flex items-center gap-1 transition"
                            >
                              {expandedIds.has(item.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              {expandedIds.has(item.id) ? 'Ocultar' : 'Ver'}
                            </button>
                            
                            {/* PREMIUM STRUCTURED VISUAL DIFF ON EXPAND */}
                            {expandedIds.has(item.id) && (
                              <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 max-w-lg shadow-inner text-left">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Detalhamento Visual</div>
                                <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                                  {item.friendly_details.length === 0 ? (
                                    <span className="text-slate-400 italic text-xs">Sem detalhes das modificações</span>
                                  ) : (
                                    item.friendly_details.map((detail, idx) => {
                                      // Captura formato "Campo: de VALOR1 para VALOR2"
                                      const match = detail.match(/(.*?):\s*de\s*(.*?)\s*para\s*(.*)/);
                                      if (match) {
                                        const [, campo, de, para] = match;
                                        return (
                                          <div key={idx} className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 text-xs font-mono shadow-sm">
                                            <div className="font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{campo}</div>
                                            <div className="grid grid-cols-2 gap-2">
                                              <div className="p-1.5 px-2 rounded bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 border border-rose-100 dark:border-rose-950 overflow-hidden text-ellipsis">
                                                <span className="text-[9px] uppercase font-bold mr-1 block text-rose-400">Antes:</span>
                                                {de || <span className="italic text-rose-300">Vazio</span>}
                                              </div>
                                              <div className="p-1.5 px-2 rounded bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-950 overflow-hidden text-ellipsis">
                                                <span className="text-[9px] uppercase font-bold mr-1 block text-emerald-400">Depois:</span>
                                                {para || <span className="italic text-emerald-300">Vazio</span>}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      }
                                      return (
                                        <div key={idx} className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 text-xs font-mono flex items-center gap-1 shadow-sm">
                                          <span className="text-slate-400 font-bold">•</span>
                                          <span>{detail}</span>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                                <button
                                  onClick={() => toggleExpanded(item.id)}
                                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition uppercase tracking-wider block mt-1 pt-2 border-t border-slate-200/60 dark:border-slate-800"
                                >
                                  ✕ Ocultar
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {item.is_undoable ? (
                              item.undone ? (
                                <button
                                  onClick={() => handleRedo(item.id)}
                                  disabled={isRowLoading}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 flex items-center gap-1 transition inline-flex"
                                >
                                  <Redo2 className="w-3 h-3" />
                                  Refazer
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleUndo(item.id)}
                                  disabled={isRowLoading}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50 flex items-center gap-1 transition inline-flex"
                                >
                                  <Undo2 className="w-3 h-3" />
                                  Desfazer
                                </button>
                              )
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600 font-mono">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400">Total: {total}</div>
              <div className="flex items-center gap-2">
                <select
                  value={limit}
                  onChange={(e) => { setPage(0); setLimit(Number(e.target.value)); }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-100"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-100 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-xs text-slate-500">{page + 1} / {totalPages}</div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page + 1 >= totalPages}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-100 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB: LOTES DE IMPORTAÇÃO
           ======================================================== */}
        {currentTab === 'lotes' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 text-left">Arquivo / Lote</th>
                    <th className="py-3 px-4 text-left">Data de Importação</th>
                    <th className="py-3 px-4 text-left">Responsável</th>
                    <th className="py-3 px-4 text-left">Total de Alterações</th>
                    <th className="py-3 px-4 text-left">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {batches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <CheckCircle2 className="w-7 h-7 text-slate-300" />
                          <p className="font-semibold text-slate-600 dark:text-slate-400">Nenhum lote importado</p>
                          <p className="text-xs text-slate-400">Os lotes gerados por importação de arquivos (como OFX) aparecerão aqui.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    batches.map((batch) => {
                      const parsed = parseBatchId(batch.batch_id);
                      const isRowLoading = undoingBatchId === batch.batch_id;
                      return (
                        <tr key={batch.batch_id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${batch.undone ? 'opacity-65 bg-rose-50/20 dark:bg-rose-950/10' : ''}`}>
                          <td className="py-4 px-4">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-700 dark:text-slate-200 font-mono">
                                {parsed.filename}
                              </span>
                              {parsed.type === 'OFX' && (
                                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mt-0.5">
                                  Extrato OFX
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-slate-400 text-xs font-mono">
                            {formatDateTime(batch.created_at)}
                          </td>
                          <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                            {batch.user_email || 'Sistema'}
                          </td>
                          <td className="py-4 px-4 text-slate-600 dark:text-slate-300 font-semibold">
                            {batch.total_itens}
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-2 py-0.5 text-xs rounded-lg font-bold ${
                              batch.undone
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400 border border-rose-200/55'
                                : 'bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-200/55'
                            }`}>
                              {batch.undone ? 'DESFEITO' : 'ATIVO'}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <div className="flex justify-end gap-1.5 items-center">
                              {/* PREVIEW OF CHANGES BATCH */}
                              <button
                                onClick={() => loadBatchPreview(batch.batch_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 transition"
                              >
                                Preview Impacto
                              </button>

                              {!batch.undone ? (
                                <button
                                  onClick={() => handleUndoBatch(batch.batch_id)}
                                  disabled={isRowLoading}
                                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 flex items-center gap-1.5 transition animate-pulse"
                                >
                                  {isRowLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                                  Desfazer Lote
                                </button>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-600 text-xs font-semibold pr-2">Desfeito</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* RESOLUTION MODAL OVERLAY */}
      {resolvingId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => { setResolvingId(null); setMotivoResolucao(''); setPasswordConfirm(''); setQuickAction(null); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              {quickAction ? 'Confirmar Ação de Remediação' : 'Resolver Alerta de Auditoria'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {quickAction 
                ? 'Esta ação executará uma correção direta no banco de dados e resolverá o alerta.'
                : 'Descreva as providências tomadas ou justifique o encerramento do alerta para auditorias futuras.'}
            </p>

            {!quickAction && (
              <div className="mt-4">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Motivo / Justificativa
                </label>
                <textarea
                  value={motivoResolucao}
                  onChange={(e) => setMotivoResolucao(e.target.value)}
                  placeholder="Ex: Lançamento verificado junto ao gerente da conta e conciliação efetuada de forma manual após validação do extrato físico."
                  rows={4}
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500 transition resize-none"
                />
              </div>
            )}

            {/* STEP-UP AUTH: PASSWORD CONFIRMATION FOR ALTS/CRITICALS */}
            {requiresPasswordConfirm && (
              <div className="mt-4 p-4 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30">
                <label className="block text-[10px] font-bold text-rose-500 dark:text-rose-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5" /> Senha do Supervisor Necessária
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Digite sua senha para confirmar"
                  className="w-full p-2.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500/25 focus:border-rose-500 transition"
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => { setResolvingId(null); setMotivoResolucao(''); setPasswordConfirm(''); setQuickAction(null); }}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleResolveAlertSubmit}
                disabled={submittingResolucao || (!quickAction && !motivoResolucao.trim()) || (requiresPasswordConfirm && !passwordConfirm)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition flex items-center gap-1.5"
              >
                {submittingResolucao ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OPERATIONAL TIMELINE MODAL */}
      {timelineOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full shadow-2xl p-6 relative flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => { setTimelineOpen(false); setTimelineData([]); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-500" />
              Linha do Tempo Operacional
            </h3>
            <p className="text-xs text-slate-400 mt-1">Histórico completo de criação, alteração e baixas desta transação.</p>

            <div className="mt-6 flex-1 overflow-y-auto pr-1 space-y-6 relative border-l-2 border-slate-150 dark:border-slate-700 pl-4 ml-2">
              {timelineLoading ? (
                <div className="text-center text-slate-400 text-xs py-8">Carregando timeline...</div>
              ) : timelineData.length === 0 ? (
                <div className="text-center text-slate-400 text-xs py-8">Nenhum histórico operacional encontrado</div>
              ) : (
                timelineData.map((t, idx) => (
                  <div key={idx} className="relative group text-left">
                    {/* TIMELINE BULLET */}
                    <div className="absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border border-white dark:border-slate-800 group-hover:scale-125 transition" />
                    
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-semibold text-indigo-500 dark:text-indigo-400">{t.tabela_exibicao} - {t.acao}</span>
                      <span className="font-mono">{formatDateTime(t.data)}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1">Operado por: {t.usuario}</p>
                    
                    {t.changes && t.changes.length > 0 && (
                      <div className="mt-2 space-y-1 bg-slate-50 dark:bg-slate-900 p-2 rounded-lg border border-slate-150 dark:border-slate-750 font-mono text-[10px]">
                        {t.changes.map((c: any, cidx: number) => (
                          <div key={cidx} className="flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-800 pb-1 mb-1 last:border-0 last:pb-0 last:mb-0">
                            <span className="font-bold text-slate-400">{c.campo}:</span>
                            <span className="text-rose-500 line-through">De: {c.de !== null ? String(c.de) : 'Vazio'}</span>
                            <span className="text-emerald-500">Para: {c.para !== null ? String(c.para) : 'Vazio'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => { setTimelineOpen(false); setTimelineData([]); }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BATCH PREVIEW MODAL */}
      {batchPreviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full shadow-2xl p-6 relative flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => { setBatchPreviewModalOpen(false); setBatchPreviewData([]); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Eye className="w-5 h-5 text-indigo-500" />
              Preview de Desfazer Lote
            </h3>
            <p className="text-xs text-slate-400 mt-1">Impactos e reversões que serão executadas ao desfazer este lote.</p>

            <div className="mt-6 flex-1 overflow-y-auto pr-1 space-y-2">
              {batchPreviewLoading ? (
                <div className="text-center text-slate-400 text-xs py-8">Carregando preview...</div>
              ) : batchPreviewData.length === 0 ? (
                <div className="text-center text-slate-400 text-xs py-8">Nenhuma operação gravada neste lote</div>
              ) : (
                batchPreviewData.map((item, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-white">{item.tabela_exibicao} ({item.detalhe})</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Operação Original: {item.acao_original}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      item.acao_reversa === 'Restaurar' 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20' 
                        : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/20'
                    }`}>
                      {item.acao_reversa}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => { setBatchPreviewModalOpen(false); setBatchPreviewData([]); }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition"
              >
                Fechar Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SILENCING RULES MODAL */}
      {silencingModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full shadow-2xl p-6 relative flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200 text-left">
            <button
              onClick={() => setSilencingModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <EyeOff className="w-5 h-5 text-indigo-500" />
              Regras de Silenciamento de Auditoria
            </h3>
            <p className="text-xs text-slate-400 mt-1">Configure o silenciamento automático para tipos de anomalias que representam falsos positivos recorrentes.</p>

            {/* FORM TO ADD RULE */}
            <div className="mt-6 bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-150 dark:border-slate-750 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tipo de Anomalia</label>
                <select
                  value={newRule.tipo_anomalia}
                  onChange={(e) => setNewRule(prev => ({ ...prev, tipo_anomalia: e.target.value }))}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-100 outline-none"
                >
                  {Object.entries(ANOMALY_TRANSLATIONS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Plano de Contas (Opcional)</label>
                <select
                  value={newRule.plano_contas_id}
                  onChange={(e) => setNewRule(prev => ({ ...prev, plano_contas_id: e.target.value }))}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-100 outline-none"
                >
                  <option value="">Qualquer Categoria</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fornecedor / Cliente (Opcional)</label>
                <select
                  value={newRule.entidade_id}
                  onChange={(e) => setNewRule(prev => ({ ...prev, entidade_id: e.target.value }))}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-100 outline-none"
                >
                  <option value="">Qualquer Entidade</option>
                  {entities.map(e => (
                    <option key={e.id} value={e.id}>{e.nome}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor Limite (Opcional)</label>
                <input
                  type="number"
                  value={newRule.valor_limite}
                  onChange={(e) => setNewRule(prev => ({ ...prev, valor_limite: e.target.value }))}
                  placeholder="Ex: 500"
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-100 outline-none"
                />
              </div>

              <button
                onClick={createSilencingRule}
                className="md:col-span-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <Plus className="w-4 h-4" />
                Cadastrar Regra de Silenciamento
              </button>
            </div>

            {/* LIST OF RULES */}
            <div className="mt-6 flex-1 overflow-y-auto pr-1">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Regras Ativas</div>
              
              {silencingRules.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">Nenhuma regra de silenciamento cadastrada</div>
              ) : (
                <div className="space-y-2">
                  {silencingRules.map((rule) => {
                    const category = categories.find(c => c.id === rule.plano_contas_id);
                    const entity = entities.find(e => e.id === rule.entidade_id);
                    return (
                      <div key={rule.id} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between hover:shadow-sm transition">
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-white text-xs">
                            Silenciar: {ANOMALY_TRANSLATIONS[rule.tipo_anomalia] || rule.tipo_anomalia}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-slate-400">
                            {category && <span>Categoria: <strong>{category.nome}</strong></span>}
                            {entity && <span>Entidade: <strong>{entity.nome}</strong></span>}
                            {rule.valor_limite !== undefined && <span>Valor Máximo: <strong>R$ {rule.valor_limite.toFixed(2)}</strong></span>}
                            {!category && !entity && rule.valor_limite === undefined && <span>Sem filtros (Total)</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => deleteSilencingRule(rule.id)}
                          className="p-1.5 rounded-lg border border-rose-100 dark:border-rose-950 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition"
                          title="Remover Regra"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSilencingModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST SYSTEM */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg border text-white transition-all duration-300 ${
                toast.type === 'success'
                  ? 'bg-emerald-600 border-emerald-500'
                  : toast.type === 'error'
                  ? 'bg-rose-600 border-rose-500'
                  : 'bg-blue-600 border-blue-500'
              }`}
            >
              <span className="flex-1">{toast.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="opacity-70 hover:opacity-100 text-white font-bold"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

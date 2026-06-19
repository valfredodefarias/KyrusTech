import { useEffect, useMemo, useState } from 'react';
import { api, normalizeListResponse } from '../services/api';
import { RefreshCw, Search, ChevronLeft, ChevronRight, Eye, EyeOff, Undo2, Redo2 } from 'lucide-react';

interface AuditLogItem {
  id: number;
  table_name: string;
  record_id: number;
  action: string;
  changes?: any;
  user_id?: number;
  user_email?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
  undone?: boolean;
}

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');

export function Auditoria() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [tableName, setTableName] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [q, setQ] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

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

  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});

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

  useEffect(() => {
    const id = setTimeout(() => {
      loadAuditoria();
    }, 400);

    return () => clearTimeout(id);
  }, [page, limit, tableName, action, userId, q, start, end]);

  async function loadAuditoria(silent: boolean = false) {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/auditoria/', {
        params: {
          skip: page * limit,
          limit,
          table_name: tableName || undefined,
          action: action || undefined,
          user_id: userId ? Number(userId) : undefined,
          q: q || undefined,
          start: start || undefined,
          end: end || undefined
        }
      });
      const items = normalizeListResponse<AuditLogItem>(data.items ?? data);
      setItems(items);
      setTotal(Number(data?.total ?? items.length ?? 0));
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Auditoria</h2>
          <p className="text-sm text-slate-400">Eventos do sistema com filtros e paginação</p>
        </div>
        <button
          onClick={() => loadAuditoria()}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition"
          title="Atualizar"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="p-6 space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => { setPage(0); setQ(e.target.value); }}
              placeholder="Pesquisar"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
            />
          </div>
          <input
            value={tableName}
            onChange={(e) => { setPage(0); setTableName(e.target.value); }}
            placeholder="Tabela"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            value={action}
            onChange={(e) => { setPage(0); setAction(e.target.value); }}
            placeholder="Ação"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            value={userId}
            onChange={(e) => { setPage(0); setUserId(e.target.value); }}
            placeholder="User ID"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => { setPage(0); setStart(e.target.value); }}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => { setPage(0); setEnd(e.target.value); }}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 uppercase">
              <tr>
                <th className="py-2 text-left">Data</th>
                <th className="py-2 text-left">Usuário</th>
                <th className="py-2 text-left">Ação</th>
                <th className="py-2 text-left">Tabela</th>
                <th className="py-2 text-left">Registro</th>
                <th className="py-2 text-left">Detalhes</th>
                <th className="py-2 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">Carregando...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">Sem eventos encontrados.</td></tr>
              ) : (
                items.map(item => {
                  const isUndoable = ['CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE'].includes(item.action);
                  const isRowLoading = actionLoading[item.id];
                  return (
                    <tr key={item.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${item.undone ? 'opacity-60 bg-rose-50/20 dark:bg-rose-950/10' : ''}`}>
                      <td className="py-3 text-slate-500 font-mono">{formatDateTime(item.created_at)}</td>
                      <td className="py-3 text-slate-700 dark:text-slate-100">{item.user_email || item.user_id || 'Sistema (sem usuário)'}</td>
                      <td className="py-3 text-slate-700 dark:text-slate-100 flex items-center gap-2">
                        {item.action}
                        {item.undone && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            Desfeito
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-slate-700 dark:text-slate-100">{item.table_name}</td>
                      <td className="py-3 text-slate-700 dark:text-slate-100 font-mono">#{item.record_id}</td>
                      <td className="py-3">
                        <button
                          onClick={() => toggleExpanded(item.id)}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40 flex items-center gap-1"
                        >
                          {expandedIds.has(item.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {expandedIds.has(item.id) ? 'Ocultar' : 'Ver'}
                        </button>
                        {expandedIds.has(item.id) && (
                          <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700">
                            {JSON.stringify(item.changes || {}, null, 2)}
                          </pre>
                        )}
                      </td>
                      <td className="py-3">
                        {isUndoable ? (
                          item.undone ? (
                            <button
                              onClick={() => handleRedo(item.id)}
                              disabled={isRowLoading}
                              className="px-2.5 py-1 text-[11px] font-bold rounded border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 flex items-center gap-1 transition"
                            >
                              <Redo2 className="w-3.5 h-3.5" />
                              Refazer
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUndo(item.id)}
                              disabled={isRowLoading}
                              className="px-2.5 py-1 text-[11px] font-bold rounded border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50 flex items-center gap-1 transition"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
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

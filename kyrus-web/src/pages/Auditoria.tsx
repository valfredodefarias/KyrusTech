import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { RefreshCw, Search, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';

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

  useEffect(() => {
    const id = setTimeout(() => {
      loadAuditoria();
    }, 400);

    return () => clearTimeout(id);
  }, [page, limit, tableName, action, userId, q, start, end]);

  async function loadAuditoria() {
    setLoading(true);
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
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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
          onClick={loadAuditoria}
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
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
            />
          </div>
          <input
            value={tableName}
            onChange={(e) => { setPage(0); setTableName(e.target.value); }}
            placeholder="Tabela"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            value={action}
            onChange={(e) => { setPage(0); setAction(e.target.value); }}
            placeholder="Ação"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            value={userId}
            onChange={(e) => { setPage(0); setUserId(e.target.value); }}
            placeholder="User ID"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
          />
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => { setPage(0); setStart(e.target.value); }}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 outline-none"
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
                <th className="py-2 text-left">IP</th>
                <th className="py-2 text-left">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">Carregando...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">Sem eventos encontrados.</td></tr>
              ) : (
                items.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="py-3 text-slate-500 font-mono">{formatDateTime(item.created_at)}</td>
                    <td className="py-3 text-slate-700 dark:text-slate-100">{item.user_email || item.user_id || '-'}</td>
                    <td className="py-3 text-slate-700 dark:text-slate-100">{item.action}</td>
                    <td className="py-3 text-slate-700 dark:text-slate-100">{item.table_name}</td>
                    <td className="py-3 text-slate-700 dark:text-slate-100">#{item.record_id}</td>
                    <td className="py-3 text-slate-500">{item.ip_address || '-'}</td>
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
                  </tr>
                ))
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
    </div>
  );
}

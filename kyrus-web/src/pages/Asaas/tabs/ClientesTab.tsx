import React, { useState, useEffect } from 'react';
import { 
  Users, Search, Plus, Mail, Phone, MapPin, 
  CreditCard, Loader2, RefreshCw, Sparkles, ExternalLink
} from 'lucide-react';
import { api } from '../../../services/api';
import { toast } from 'sonner';
import type { AsaasCliente } from '../types';

interface ClientesTabProps {
  integracaoId: number;
  onCobrarCliente: (cliente: { nome: string; cpfCnpj?: string | null; email?: string | null; phone?: string | null }) => void;
}

export function ClientesTab({
  integracaoId,
  onCobrarCliente,
}: ClientesTabProps) {
  const [clientes, setClientes] = useState<AsaasCliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchClientes = async () => {
    try {
      setLoading(true);
      const params: any = { limit: 100 };
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const res = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/clientes-gerencial`, { params });
      setClientes(res.data || []);
    } catch (err) {
      toast.error('Erro ao consultar clientes do Asaas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClientes();
  }, [integracaoId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchClientes();
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Top Filter */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome do cliente ou documento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => { setSearchTerm(''); fetchClientes(); }}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          )}
        </form>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchClientes()}
            title="Atualizar lista de clientes"
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Grid de Clientes */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span>Consultando clientes no Asaas...</span>
          </div>
        ) : clientes.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            Nenhum cliente cadastrado no Asaas encontrado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850/80 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">Cliente / Razão Social</th>
                  <th className="py-3 px-4">Documento</th>
                  <th className="py-3 px-4">Contato</th>
                  <th className="py-3 px-4">Localidade</th>
                  <th className="py-3 px-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {clientes.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-850/40 transition group"
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {c.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        ID: {c.id}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {c.cpfCnpj || '-'}
                    </td>

                    <td className="py-3 px-4">
                      <div className="space-y-0.5">
                        {c.email && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span>{c.email}</span>
                          </div>
                        )}
                        {c.phone && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{c.phone}</span>
                          </div>
                        )}
                        {!c.email && !c.phone && <span className="text-slate-400">-</span>}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ''}` : '-'}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => onCobrarCliente({
                          nome: c.name,
                          cpfCnpj: c.cpfCnpj,
                          email: c.email,
                          phone: c.phone,
                        })}
                        className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-600 hover:text-white text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-xs font-bold transition flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Cobrar</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

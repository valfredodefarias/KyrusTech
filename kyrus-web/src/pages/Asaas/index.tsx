import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  CreditCard, RefreshCw, Plus, Settings, ChevronDown, 
  Layers, Users, Calendar, DollarSign, Percent, 
  Link2, Sparkles, AlertCircle, ArrowRight, ShieldCheck, CheckCircle2
} from 'lucide-react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import type { AsaasConta, AsaasDashboardData } from './types';
import { VisaoGeralTab } from './tabs/VisaoGeralTab';
import { CobrancasTab } from './tabs/CobrancasTab';
import { ClientesTab } from './tabs/ClientesTab';
import { PrevisoesTab } from './tabs/PrevisoesTab';
import { GastosTab } from './tabs/GastosTab';
import { LinksTab } from './tabs/LinksTab';
import { NovaCobrancaModal } from './components/NovaCobrancaModal';

export function AsaasApp() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Contas Asaas da empresa
  const [contas, setContas] = useState<AsaasConta[]>([]);
  const [contaSelecionadaId, setContaSelecionadaId] = useState<number | null>(null);
  const [loadingContas, setLoadingContas] = useState(true);

  // Aba ativa
  const [activeTab, setActiveTab] = useState<'visao_geral' | 'cobrancas' | 'clientes' | 'previsoes' | 'gastos' | 'links'>('visao_geral');

  // Filtros dinâmicos para a aba de Cobranças
  const [cobrancasFiltros, setCobrancasFiltros] = useState<{ status?: string; meio?: string }>({});

  const handleNavigateTab = (tab: string, filters?: { status?: string; meio?: string }) => {
    if (filters) {
      setCobrancasFiltros(filters);
    }
    setActiveTab(tab as any);
  };

  // Dados do Dashboard
  const [dashboardData, setDashboardData] = useState<AsaasDashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Modal de Nova Cobrança
  const [isNovaCobrancaOpen, setIsNovaCobrancaOpen] = useState(false);
  const [clientePredefinido, setClientePredefinido] = useState<{
    nome: string;
    cpfCnpj?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null>(null);

  // Carrega contas Asaas configuradas
  const fetchContas = async () => {
    try {
      setLoadingContas(true);
      const res = await api.get('/integracoes-bancarias/asaas/contas');
      const lista: AsaasConta[] = res.data || [];
      setContas(lista);

      if (lista.length > 0) {
        // Se URL tiver parâmetro de conta, prioriza
        const paramId = searchParams.get('conta_id');
        const encontrada = paramId ? lista.find(c => c.id === parseInt(paramId, 10)) : null;
        setContaSelecionadaId(encontrada ? encontrada.id : lista[0].id);
      }
    } catch (err) {
      toast.error('Erro ao listar contas Asaas configuradas');
    } finally {
      setLoadingContas(false);
    }
  };

  useEffect(() => {
    fetchContas();
  }, []);

  // Carrega dados do dashboard da conta selecionada
  const fetchDashboard = async () => {
    if (!contaSelecionadaId) return;
    try {
      setLoadingDashboard(true);
      const res = await api.get(`/integracoes-bancarias/${contaSelecionadaId}/asaas/dashboard`);
      setDashboardData(res.data);
    } catch (err) {
      toast.error('Erro ao atualizar métricas do Asaas');
    } finally {
      setLoadingDashboard(false);
    }
  };

  useEffect(() => {
    if (contaSelecionadaId) {
      fetchDashboard();
    }
  }, [contaSelecionadaId]);

  // Sincronização manual
  const handleSync = async () => {
    if (!contaSelecionadaId) return;
    try {
      setSyncing(true);
      await api.post(`/integracoes-bancarias/${contaSelecionadaId}/sincronizar`);
      toast.success('Sincronização com o Asaas concluída com sucesso!');
      await fetchDashboard();
      await fetchContas();
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Erro ao sincronizar com o Asaas';
      toast.error(String(msg));
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenCobrarCliente = (cliente: { nome: string; cpfCnpj?: string | null; email?: string | null; phone?: string | null }) => {
    setClientePredefinido(cliente);
    setIsNovaCobrancaOpen(true);
  };

  const contaAtual = contas.find(c => c.id === contaSelecionadaId);

  // Se não houver conta Asaas configurada
  if (!loadingContas && contas.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-8 text-center space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 w-fit mx-auto border border-blue-200 dark:border-blue-800">
            <CreditCard className="w-10 h-10" />
          </div>
          <div className="space-y-1.5 max-w-lg mx-auto">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Aplicativo Asaas Cobranças & Recebíveis
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Você ainda não possui nenhuma conta Asaas conectada. Integre sua conta em segundos para acompanhar clientes, previsões de recebimento, extrato de tarifas e gerar links de pagamento automáticos.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => navigate('/integracoes/asaas')}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition shadow-sm"
            >
              <span>Conectar Primeira Conta Asaas</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-in fade-in duration-300">
      {/* Top Header / Account Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
            <CreditCard className="w-6 h-6" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Asaas Cobranças
              </h1>

              {/* Seletor de Contas Asaas se houver mais de uma */}
              {contas.length > 1 ? (
                <div className="relative">
                  <select
                    value={contaSelecionadaId || ''}
                    onChange={(e) => setContaSelecionadaId(parseInt(e.target.value, 10))}
                    className="px-2.5 py-1 text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} {c.conta_nome ? `(${c.conta_nome})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : contaAtual ? (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  {contaAtual.nome}
                </span>
              ) : null}

              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                PRODUÇÃO
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Painel gerencial de pagadores, agenda de recebimentos, tarifas e emissão instantânea
            </p>
          </div>
        </div>

        {/* Ações do Header */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Botão Sincronizar */}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            title="Sincronizar movimentações recentes do Asaas"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-blue-600' : ''}`} />
            <span>{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
          </button>

          {/* Botão Configurações Técnicas */}
          <button
            type="button"
            onClick={() => navigate(`/integracoes/asaas${contaSelecionadaId ? `?integracao_id=${contaSelecionadaId}` : ''}`)}
            className="px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            title="Configurações de conexão, token e mapeamento bancário"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configurações</span>
          </button>

          {/* Botão Nova Cobrança */}
          <button
            type="button"
            onClick={() => {
              setClientePredefinido(null);
              setIsNovaCobrancaOpen(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 shadow-sm whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Cobrança / Link</span>
          </button>
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto gap-1 shrink-0">
        {[
          { id: 'visao_geral', label: 'Visão Geral', icon: Layers },
          { id: 'cobrancas', label: 'Cobranças', icon: CreditCard },
          { id: 'clientes', label: 'Clientes', icon: Users },
          { id: 'previsoes', label: 'Previsões de Recebimento', icon: Calendar },
          { id: 'gastos', label: 'Gastos & Tarifas', icon: Percent },
          { id: 'links', label: 'Links de Pagamento', icon: Link2 },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'cobrancas') {
                  setCobrancasFiltros({});
                }
                setActiveTab(tab.id as any);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo das Abas */}
      {contaSelecionadaId && (
        <div className="space-y-4">
          {activeTab === 'visao_geral' && (
            <VisaoGeralTab
              integracaoId={contaSelecionadaId}
              data={dashboardData}
              onNavigateTab={handleNavigateTab}
              onOpenNovaCobranca={() => setIsNovaCobrancaOpen(true)}
              onRefresh={fetchDashboard}
            />
          )}

          {activeTab === 'cobrancas' && (
            <CobrancasTab
              integracaoId={contaSelecionadaId}
              onOpenNovaCobranca={() => setIsNovaCobrancaOpen(true)}
              initialStatus={cobrancasFiltros.status}
              initialMeio={cobrancasFiltros.meio}
              onClearFilters={() => setCobrancasFiltros({})}
            />
          )}

          {activeTab === 'clientes' && (
            <ClientesTab
              integracaoId={contaSelecionadaId}
              onCobrarCliente={handleOpenCobrarCliente}
            />
          )}

          {activeTab === 'previsoes' && (
            <PrevisoesTab
              previsoes={dashboardData?.previsoes_timeline || []}
              totalAReceber={dashboardData?.kpis.total_a_receber || 0}
            />
          )}

          {activeTab === 'gastos' && (
            <GastosTab
              gastos={dashboardData?.gastos_por_categoria || []}
              totalGastos={dashboardData?.kpis.total_gastos || 0}
              totalFaturado={dashboardData?.kpis.total_faturado || 0}
              taxaMediaEfetiva={dashboardData?.kpis.taxa_media_efetiva || 0}
            />
          )}

          {activeTab === 'links' && (
            <LinksTab
              onOpenNovaCobranca={() => setIsNovaCobrancaOpen(true)}
            />
          )}
        </div>
      )}

      {/* Modal de Nova Cobrança */}
      {contaSelecionadaId && (
        <NovaCobrancaModal
          isOpen={isNovaCobrancaOpen}
          onClose={() => {
            setIsNovaCobrancaOpen(false);
            setClientePredefinido(null);
          }}
          integracaoId={contaSelecionadaId}
          clientePredefinido={clientePredefinido}
          onSuccess={() => {
            fetchDashboard();
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { BankAvatar } from '../components/BrandAvatar';
import {
  Home as HomeIcon,
  Wallet,
  Banknote,
  PlusCircle,
  Activity,
  Landmark,
  Building2,
  CreditCard,
  Settings,
  ShoppingBag,
  ArrowRight,
} from 'lucide-react';

interface ContaResumo {
  id: number;
  nome: string;
  tipo: string;
  logo_url?: string | null;
  banco?: string | null;
  centro_custo_id?: number | null;
  saldo_inicial: number;
  saldo_atual?: number;
  status?: 'ATIVO' | 'INATIVO' | string;
  conta_como_disponibilidade?: boolean;
}

interface CentroCustoResumo {
  id: number;
  nome: string;
  codigo?: string | null;
}

interface UserInfo {
  email: string;
  empresa_id?: number | null;
  is_consultor?: boolean;
  nome?: string | null;
}

interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  cor_primaria?: string;
}

interface ConsultorContextoResponse {
  empresa_atual: EmpresaInfo;
}

interface AtalhoCardProps {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description: string;
  colorClass: string;
  bgClass: string;
}

function resolveCentroCustoInicial(
  centros: CentroCustoResumo[],
  contas: ContaResumo[],
): number | null {
  if (!centros.length) return null;

  const centroIds = new Set(centros.map((centro) => Number(centro.id)));

  const contaAtivaComCentro = contas
    .filter((conta) => String(conta.status || 'ATIVO').toUpperCase() === 'ATIVO' && conta.conta_como_disponibilidade !== false)
    .map((conta) => Number(conta.centro_custo_id))
    .find((centroId) => Number.isFinite(centroId) && centroIds.has(centroId));

  if (Number.isFinite(contaAtivaComCentro)) {
    return Number(contaAtivaComCentro);
  }

  return Number(centros[0].id);
}

export function Home() {
  const user = useAuthStore((state) => state.user);
  const empresa = useAuthStore((state) => state.empresa);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoResumo[]>([]);
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);

  useEffect(() => {
    let active = true;
    async function loadData() {
      try {
        const [contasData, centrosData] = await Promise.all([
          fetchContas(),
          fetchCentrosCusto(),
        ]);

        if (!active) return;

        setContas(contasData);
        setCentrosCusto(centrosData);
        setSelectedCentroCustoId(resolveCentroCustoInicial(centrosData, contasData));
      } catch (error) {
        console.error('Erro ao carregar home:', error);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, []);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const getSaldo = (conta: ContaResumo) => {
    return conta.saldo_atual !== undefined ? Number(conta.saldo_atual) : Number(conta.saldo_inicial);
  };

  const contasVisaoGeral = useMemo(() => {
    const listaContas = Array.isArray(contas) ? contas : [];
    return listaContas.filter(
      (conta) => String(conta.status || 'ATIVO').toUpperCase() === 'ATIVO'
        && conta.conta_como_disponibilidade !== false
        && (selectedCentroCustoId === null || Number(conta.centro_custo_id) === selectedCentroCustoId),
    );
  }, [contas, selectedCentroCustoId]);

  const saldoTotal = useMemo(() => contasVisaoGeral.reduce((acc, conta) => acc + getSaldo(conta), 0), [contasVisaoGeral]);
  const contasPositivas = useMemo(() => contasVisaoGeral.filter((conta) => getSaldo(conta) >= 0).length, [contasVisaoGeral]);
  const contasNegativas = useMemo(() => contasVisaoGeral.filter((conta) => getSaldo(conta) < 0).length, [contasVisaoGeral]);

  const nomeUsuario = user?.nome || user?.email?.split('@')[0] || 'Usuário';
  const primaryColor = empresa?.cor_primaria || '#2563eb';


  if (loading) {
    return <div className="p-10 text-center animate-pulse text-slate-500">Carregando painel...</div>;
  }

  const atalhos: AtalhoCardProps[] = [
    {
      to: '/boletim',
      icon: Activity,
      label: 'Boletim',
      description: 'Leitura financeira diária',
      colorClass: 'text-cyan-600',
      bgClass: 'bg-cyan-100 dark:bg-cyan-500/10',
    },
    {
      to: '/lancamentos',
      icon: PlusCircle,
      label: 'Lançamentos',
      description: 'Registrar entradas e saídas',
      colorClass: 'text-emerald-600',
      bgClass: 'bg-emerald-100 dark:bg-emerald-500/10',
    },
    {
      to: '/centro-custo',
      icon: Building2,
      label: 'Centro de custo',
      description: 'Organização por unidade e área',
      colorClass: 'text-blue-600',
      bgClass: 'bg-blue-100 dark:bg-blue-500/10',
    },
    {
      to: '/contas',
      icon: Landmark,
      label: 'Contas',
      description: 'Bancos, caixas e saldos',
      colorClass: 'text-violet-600',
      bgClass: 'bg-violet-100 dark:bg-violet-500/10',
    },
    {
      to: '/cartoes',
      icon: CreditCard,
      label: 'Cartões',
      description: 'Faturas e limites',
      colorClass: 'text-amber-600',
      bgClass: 'bg-amber-100 dark:bg-amber-500/10',
    },
    {
      to: '/pdv',
      icon: ShoppingBag,
      label: 'PDV',
      description: 'Caixa, vendas e operação',
      colorClass: 'text-fuchsia-600',
      bgClass: 'bg-fuchsia-100 dark:bg-fuchsia-500/10',
    },
    {
      to: '/config',
      icon: Settings,
      label: 'Configurações',
      description: 'Preferências do sistema',
      colorClass: 'text-slate-600',
      bgClass: 'bg-slate-100 dark:bg-slate-700/60',
    },
  ];

  return (
    <div className="w-full space-y-6 animate-fade-in p-4 md:p-6 pb-8">
      <header className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-700 dark:text-white">
          <HomeIcon className="w-5 h-5" style={{ color: primaryColor }} /> Visão Geral
        </h2>
        <div className="text-sm text-slate-500 dark:text-slate-400 capitalize">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </header>

      <section className="rounded-md border border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-[#161b22]/30 p-5 sm:p-6 text-slate-800 dark:text-slate-200 shadow-none">
        <div className="relative z-10">
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">Olá, {nomeUsuario}!</h1>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeroMetric label="Saldo consolidado" value={BRL.format(saldoTotal)} />
            <HeroMetric label="Contas ativas" value={String(contasVisaoGeral.length)} />
            <HeroMetric label="Saldo positivo" value={String(contasPositivas)} />
            <HeroMetric label="Em atenção" value={String(contasNegativas)} />
          </div>

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link to="/lancamentos" className="bg-primary hover:opacity-90 text-white px-4 py-2 rounded-md font-bold text-sm transition shadow-sm flex items-center gap-1.5 w-full sm:w-auto justify-center" style={{ backgroundColor: primaryColor }}>
              <PlusCircle size={16} /> Novo Lançamento
            </Link>
            <Link to="/boletim" className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-250 px-4 py-2 rounded-md font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-750 transition flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 w-full sm:w-auto justify-center">
              <Activity size={16} /> Abrir Boletim
            </Link>
            <label className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-250 px-3 py-2 rounded-md font-semibold border border-slate-200 dark:border-slate-700 flex items-center gap-2 w-full sm:w-auto text-xs">
              <Building2 size={14} className="shrink-0 text-slate-400" />
              <span className="uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Centro</span>
              <select
                value={selectedCentroCustoId === null ? '' : String(selectedCentroCustoId)}
                onChange={(event) => {
                  const nextId = Number(event.target.value);
                  if (!Number.isFinite(nextId) || nextId <= 0) return;
                  setSelectedCentroCustoId(nextId);
                }}
                className="min-w-[170px] bg-transparent text-slate-800 dark:text-white font-bold outline-none border-0 text-xs"
              >
                <option value="" disabled className="text-slate-900 dark:text-slate-100 dark:bg-slate-800">Selecione um centro</option>
                {centrosCusto.map((centro) => (
                  <option key={centro.id} value={centro.id} className="text-slate-900 dark:text-slate-100 dark:bg-slate-800">
                    {centro.codigo ? `${centro.codigo} - ` : ''}{centro.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-none dark:border-slate-800 dark:bg-[#0d1117]">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-sm text-slate-700 dark:text-slate-255">
          <Wallet className="w-4 h-4 text-slate-400" /> Contas e saldos
        </h3>

        <div className="max-h-[32rem] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {contasVisaoGeral.length === 0 ? (
            <div className="col-span-3 text-sm text-slate-400 p-6 border border-dashed rounded-md text-center bg-slate-50 dark:bg-slate-900/50">
              Nenhuma conta ativa que componha saldo disponível. <Link to="/contas" className="text-blue-500 hover:underline">Ajustar contas</Link>
            </div>
          ) : (
            contasVisaoGeral.map((conta) => (
              <Link
                key={conta.id}
                to={`/contas?extrato_conta_id=${conta.id}`}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-3 transition hover:bg-slate-100/30 dark:border-slate-850 dark:bg-[#161b22]/30 dark:hover:bg-[#161b22]/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0 flex items-center justify-center overflow-hidden" style={{ color: primaryColor }}>
                    {conta.tipo === 'CAIXA' ? (
                      <Banknote size={16} />
                    ) : (
                      <BankAvatar
                        logoUrl={toPublicAssetUrl(conta.logo_url) || null}
                        bankName={conta.banco}
                        accountName={conta.nome}
                        integrationType={conta.tipo}
                        size="sm"
                        className="w-8 h-8"
                        imageClassName="rounded-md"
                        fallbackClassName="rounded-md border-0 shadow-none"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-tight truncate" title={conta.nome}>{conta.nome}</p>
                    <p className="text-[9px] text-slate-450 font-bold uppercase truncate mt-0.5">{conta.tipo}</p>
                  </div>
                </div>

                <p className="font-mono text-xs font-bold text-slate-800 dark:text-white whitespace-nowrap">{BRL.format(getSaldo(conta))}</p>
              </Link>
            ))
          )}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-black uppercase tracking-[0.16em] text-slate-400">Acessos rápidos</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {atalhos.map((atalho) => (
            <AtalhoCard key={atalho.to} {...atalho} />
          ))}
        </div>
      </section>
    </div>
  );
}



function normalizeContasResponse(data: unknown): ContaResumo[] {
  if (Array.isArray(data)) {
    return data as ContaResumo[];
  }

  if (data && typeof data === 'object') {
    const payload = data as {
      data?: unknown;
      items?: unknown;
      results?: unknown;
      contas?: unknown;
    };

    const candidate = payload.data ?? payload.items ?? payload.results ?? payload.contas;
    if (Array.isArray(candidate)) {
      return candidate as ContaResumo[];
    }
  }

  return [];
}

function normalizeCentrosCustoResponse(data: unknown): CentroCustoResumo[] {
  if (Array.isArray(data)) {
    return data as CentroCustoResumo[];
  }

  if (data && typeof data === 'object') {
    const payload = data as {
      data?: unknown;
      items?: unknown;
      results?: unknown;
      centros_custo?: unknown;
    };

    const candidate = payload.data ?? payload.items ?? payload.results ?? payload.centros_custo;
    if (Array.isArray(candidate)) {
      return candidate as CentroCustoResumo[];
    }
  }

  return [];
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0d1117] px-3.5 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-800 dark:text-white font-mono leading-none">{value}</p>
    </div>
  );
}

function AtalhoCard({ to, icon: Icon, label, description, colorClass, bgClass }: AtalhoCardProps) {
  return (
    <Link to={to} className="group block rounded-md border border-slate-200 bg-white p-3.5 transition duration-150 hover:border-slate-300 dark:border-slate-800 dark:bg-[#0d1117] dark:hover:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${bgClass} ${colorClass} transition`}>
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-750 dark:text-slate-200 leading-tight truncate">{label}</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-slate-450 dark:text-slate-500 truncate mt-0.5">{description}</p>
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-450 dark:text-slate-650" />
      </div>
    </Link>
  );
}

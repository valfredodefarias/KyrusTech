import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toPublicAssetUrl } from '../services/api';
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
  ArrowRight,
} from 'lucide-react';

interface ContaResumo {
  id: number;
  nome: string;
  tipo: string;
  logo_url?: string | null;
  banco?: string | null;
  saldo_inicial: number;
  saldo_atual?: number;
  status?: 'ATIVO' | 'INATIVO' | string;
  conta_como_disponibilidade?: boolean;
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

export function Home() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const resUser = await api.get<UserInfo>('/usuarios/me');
        setUser(resUser.data);

        let empresaAtual: EmpresaInfo | null = null;
        if (resUser.data.empresa_id) {
          try {
            const resEmpresa = await api.get<EmpresaInfo>(`/empresas/${resUser.data.empresa_id}`);
            empresaAtual = resEmpresa.data;
          } catch {
            empresaAtual = null;
          }
        }

        if (!empresaAtual && resUser.data.is_consultor) {
          const resContexto = await api.get<ConsultorContextoResponse>('/consultor/meu-contexto');
          empresaAtual = resContexto.data.empresa_atual;
        }

        setEmpresa(empresaAtual);

        const resContas = await api.get<ContaResumo[]>('/contas/');
        setContas(resContas.data || []);
      } catch (error) {
        console.error('Erro ao carregar home:', error);
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const getSaldo = (conta: ContaResumo) => {
    return conta.saldo_atual !== undefined ? Number(conta.saldo_atual) : Number(conta.saldo_inicial);
  };

  const contasVisaoGeral = useMemo(
    () =>
      contas.filter(
        (conta) => String(conta.status || 'ATIVO').toUpperCase() === 'ATIVO' && conta.conta_como_disponibilidade !== false,
      ),
    [contas],
  );

  const saldoTotal = useMemo(() => contasVisaoGeral.reduce((acc, conta) => acc + getSaldo(conta), 0), [contasVisaoGeral]);
  const contasPositivas = useMemo(() => contasVisaoGeral.filter((conta) => getSaldo(conta) >= 0).length, [contasVisaoGeral]);
  const contasNegativas = useMemo(() => contasVisaoGeral.filter((conta) => getSaldo(conta) < 0).length, [contasVisaoGeral]);

  const nomeUsuario = user?.nome || user?.email?.split('@')[0] || 'Usuário';
  const primaryColor = empresa?.cor_primaria || '#2563eb';
  const bgStyle = {
    background: `linear-gradient(135deg, ${primaryColor} 0%, ${adjustBrightness(primaryColor, -20)} 100%)`,
  };

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
      to: '/config',
      icon: Settings,
      label: 'Configurações',
      description: 'Preferências do sistema',
      colorClass: 'text-slate-600',
      bgClass: 'bg-slate-100 dark:bg-slate-700/60',
    },
  ];

  return (
    <div className="w-full space-y-8 animate-fade-in pb-10">
      <header className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-700 dark:text-white">
          <HomeIcon className="w-5 h-5" style={{ color: primaryColor }} /> Visão Geral
        </h2>
        <div className="text-sm text-slate-500 dark:text-slate-400 capitalize">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </header>

      <section className="relative overflow-hidden rounded-[30px] p-6 text-white shadow-2xl shadow-slate-900/10 sm:p-8" style={bgStyle}>
        <div className="pointer-events-none absolute -right-6 top-0 h-full w-1/3 skew-x-12 bg-white/10" />
        <div className="pointer-events-none absolute -bottom-10 left-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative z-10">
          <h1 className="text-2xl font-extrabold sm:text-3xl">Olá, {nomeUsuario}!</h1>
          <p className="mt-2 text-white/90">
            Empresa atual: <strong className="bg-white/20 px-2 py-0.5 rounded">{empresa?.nome_fantasia || 'Não definida'}</strong>
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeroMetric label="Saldo consolidado" value={BRL.format(saldoTotal)} />
            <HeroMetric label="Contas ativas" value={String(contasVisaoGeral.length)} />
            <HeroMetric label="Saldo positivo" value={String(contasPositivas)} />
            <HeroMetric label="Em atenção" value={String(contasNegativas)} />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/lancamentos" className="bg-white text-slate-800 px-5 py-2.5 rounded-lg font-bold hover:bg-slate-50 transition shadow-sm flex items-center gap-2 w-full sm:w-auto justify-center">
              <PlusCircle size={18} style={{ color: primaryColor }} /> Novo Lançamento
            </Link>
            <Link to="/boletim" className="bg-black/20 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-black/30 transition flex items-center gap-2 border border-white/20 w-full sm:w-auto justify-center">
              <Activity size={18} /> Abrir Boletim
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
          <Wallet className="w-5 h-5 text-slate-400" /> Contas e saldos
        </h3>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {contasVisaoGeral.length === 0 ? (
            <div className="col-span-3 text-sm text-slate-400 p-8 border border-dashed rounded-lg text-center bg-slate-50 dark:bg-slate-800/50">
              Nenhuma conta ativa que componha saldo disponível. <Link to="/contas" className="text-blue-500 hover:underline">Ajustar contas</Link>
            </div>
          ) : (
            contasVisaoGeral.map((conta) => (
              <Link
                key={conta.id}
                to={`/contas?extrato_conta_id=${conta.id}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 shrink-0 flex items-center justify-center overflow-hidden" style={{ color: primaryColor }}>
                    {conta.tipo === 'CAIXA' ? (
                      <Banknote size={20} />
                    ) : (
                      <BankAvatar
                        logoUrl={toPublicAssetUrl(conta.logo_url) || null}
                        bankName={conta.banco}
                        accountName={conta.nome}
                        integrationType={conta.tipo}
                        size="sm"
                        className="w-10 h-10"
                        imageClassName="rounded-full"
                        fallbackClassName="rounded-full border-0 shadow-none"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-tight truncate" title={conta.nome}>{conta.nome}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase truncate">{conta.tipo}</p>
                  </div>
                </div>

                <p className="font-mono font-bold text-slate-800 dark:text-white whitespace-nowrap">{BRL.format(getSaldo(conta))}</p>
              </Link>
            ))
          )}
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

function adjustBrightness(color: string, amount: number) {
  if (!color || color[0] !== '#') return color;
  const base = color.slice(1);
  const value = parseInt(base, 16);
  if (Number.isNaN(value)) return color;

  const clamp = (channel: number) => Math.max(0, Math.min(255, channel));
  const r = clamp((value >> 16) + amount);
  const g = clamp(((value >> 8) & 0xff) + amount);
  const b = clamp((value & 0xff) + amount);

  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">{label}</p>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
    </div>
  );
}

function AtalhoCard({ to, icon: Icon, label, description, colorClass, bgClass }: AtalhoCardProps) {
  return (
    <Link to={to} className="group block rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${bgClass} ${colorClass} transition group-hover:scale-110`}>
          <Icon size={22} />
        </div>
        <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-300" />
      </div>
      <div className="mt-5">
        <p className="text-base font-black text-slate-800 dark:text-white">{label}</p>
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{description}</p>
      </div>
    </Link>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, TrendingDown, TrendingUp } from 'lucide-react';

import { AsyncApexChart } from '../components/AsyncApexChart';
import { BrandAvatar, inferBankBrand } from '../components/BrandAvatar';
import { api } from '../services/api';

interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
  tipo: string;
  saldo_inicial: number;
  saldo_atual?: number;
}

interface LancamentoResumo {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  data_vencimento: string;
  data_pagamento?: string | null;
  valor_previsto: number;
  valor_pago?: number | null;
}

interface UserInfo {
  empresa_id?: number | null;
  is_consultor?: boolean;
}

interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  razao_social?: string;
  cor_primaria?: string;
  logo_url?: string | null;
}

interface ConsultorContextoResponse {
  empresa_atual: EmpresaInfo;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const MONTH_SHORT = ['jan. de 2026', 'fev. de 2026', 'mar. de 2026', 'abr. de 2026', 'mai. de 2026', 'jun. de 2026', 'jul. de 2026', 'ago. de 2026', 'set. de 2026', 'out. de 2026', 'nov. de 2026', 'dez. de 2026'];

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function isReceita(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('R');
}

function isPago(status?: string | null) {
  return String(status || '').toUpperCase() === 'PAGO';
}

function getFullLogoUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (url.startsWith('/static')) {
    const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
    return `${baseURL}${url}`;
  }
  return url;
}

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const syncTheme = () => setIsDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('theme-change', syncTheme);
    return () => window.removeEventListener('theme-change', syncTheme);
  }, []);

  return isDark;
}

function MetricGrid({
  title,
  accent,
  metrics,
  isDark,
}: {
  title: string;
  accent: 'rose' | 'cyan';
  metrics: Array<{ label: string; value: number }>;
  isDark: boolean;
}) {
  const borderClass = accent === 'rose' ? 'border-rose-500/45' : 'border-cyan-400/45';
  const titleClass = accent === 'rose' ? 'text-rose-400' : 'text-cyan-300';

  return (
    <section className={`rounded-none border px-4 py-4 shadow-sm ${borderClass} ${isDark ? 'bg-black/90' : 'bg-white'}`}>
      <h2 className={`mb-4 text-center text-2xl font-black uppercase tracking-[0.04em] ${titleClass}`}>{title}</h2>
      <div className="grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div key={metric.label} className={`border px-4 py-5 text-center ${isDark ? 'border-white/35 bg-black' : 'border-slate-300 bg-white'}`}>
            <div className={`text-sm font-black ${titleClass}`}>{metric.label}</div>
            <div className={`mt-2 text-2xl font-light tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{BRL.format(metric.value)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultChip({ label, value, isDark }: { label: string; value: number; isDark: boolean }) {
  return (
    <div className={`border px-4 py-5 text-center ${isDark ? 'border-white/35 bg-black' : 'border-slate-300 bg-white'}`}>
      <div className="text-sm font-black text-amber-400">{label}</div>
      <div className={`mt-2 text-2xl font-light tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{BRL.format(value)}</div>
    </div>
  );
}

export function Boletim() {
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const isDark = useIsDarkMode();

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      try {
        const today = new Date();
        const yearStart = `${today.getFullYear()}-01-01`;
        const yearEnd = `${today.getFullYear()}-12-31`;

        const userRes = await api.get<UserInfo>('/usuarios/me');

        let empresaAtual: EmpresaInfo | null = null;
        if (userRes.data.empresa_id) {
          try {
            const empresaRes = await api.get<EmpresaInfo>(`/empresas/${userRes.data.empresa_id}`);
            empresaAtual = empresaRes.data;
          } catch {
            empresaAtual = null;
          }
        }

        if (!empresaAtual && userRes.data.is_consultor) {
          const contextoRes = await api.get<ConsultorContextoResponse>('/consultor/meu-contexto');
          empresaAtual = contextoRes.data.empresa_atual;
        }

        const [contasRes, lancamentosRes] = await Promise.all([
          api.get<ContaResumo[]>('/contas/'),
          api.get<LancamentoResumo[]>('/lancamentos/', { params: { limit: 10000, data_inicio: yearStart, data_fim: yearEnd } }),
        ]);

        if (!active) return;

        setEmpresa(empresaAtual);
        setContas(contasRes.data || []);
        setLancamentos(lancamentosRes.data || []);
      } catch (error) {
        console.error('Erro ao carregar boletim', error);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, []);

  const boletim = useMemo(() => {
    const today = new Date();
    const todayIso = toIsoDate(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowIso = toIsoDate(tomorrow);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const payables = lancamentos.filter((item) => !isReceita(item.tipo));
    const receivables = lancamentos.filter((item) => isReceita(item.tipo));

    const makeBlock = (items: LancamentoResumo[]) => {
      const hoje = items.filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) === todayIso).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const amanha = items.filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) === tomorrowIso).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const atrasadas = items.filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) < todayIso).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const totalMes = items.filter((item) => {
        const due = parseDateOnly(item.data_vencimento);
        return due && due >= monthStart && due <= monthEnd;
      }).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const realizadas = items.filter((item) => isPago(item.status)).reduce((acc, item) => acc + Number(item.valor_pago ?? item.valor_previsto ?? 0), 0);
      const emAberto = items.filter((item) => !isPago(item.status)).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      return { hoje, amanha, atrasadas, totalMes, realizadas, emAberto };
    };

    const pagar = makeBlock(payables);
    const receber = makeBlock(receivables);
    const bancos = [...contas]
      .map((conta) => ({ ...conta, saldo: Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0) }))
      .sort((left, right) => right.saldo - left.saldo);

    const saldoBancario = bancos.reduce((acc, conta) => acc + conta.saldo, 0);
    const operacional = receber.totalMes - pagar.totalMes;
    const final = receber.realizadas - pagar.realizadas;
    const endividamento = pagar.emAberto;
    const aReceberAberto = receber.emAberto;

    const chartReceber = Array.from({ length: 12 }, () => 0);
    const chartPagar = Array.from({ length: 12 }, () => 0);
    lancamentos.forEach((item) => {
      const due = parseDateOnly(item.data_vencimento);
      if (!due) return;
      const index = due.getMonth();
      if (isReceita(item.tipo)) {
        chartReceber[index] += Number(item.valor_previsto || 0);
      } else {
        chartPagar[index] += Number(item.valor_previsto || 0);
      }
    });

    return { pagar, receber, bancos, saldoBancario, operacional, final, endividamento, aReceberAberto, chartReceber, chartPagar };
  }, [contas, lancamentos]);

  const chartSeries = useMemo(() => ([
    { name: 'Pagamento', data: boletim.chartPagar },
    { name: 'Recebimento', data: boletim.chartReceber },
  ]), [boletim.chartPagar, boletim.chartReceber]);

  const chartOptions = useMemo<any>(() => ({
    chart: {
      toolbar: { show: false },
      background: 'transparent',
      foreColor: isDark ? '#cbd5e1' : '#475569',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    plotOptions: { bar: { columnWidth: '50%', borderRadius: 0 } },
    dataLabels: { enabled: false },
    stroke: { show: false },
    colors: ['#ef4444', '#3b82f6'],
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      labels: { colors: isDark ? '#e2e8f0' : '#334155' },
    },
    grid: { borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.28)' },
    xaxis: {
      categories: MONTH_SHORT,
      labels: { style: { colors: Array.from({ length: 12 }, () => isDark ? '#cbd5e1' : '#334155') } },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => BRL.format(value),
        style: { colors: [isDark ? '#cbd5e1' : '#334155'] },
      },
    },
    tooltip: {
      theme: isDark ? 'dark' : 'light',
      y: { formatter: (value: number) => BRL.format(value) },
    },
  }), [isDark]);

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';
  const now = new Date();

  if (loading) {
    return <div className="p-10 text-center text-slate-400">Carregando boletim...</div>;
  }

  const pageClass = isDark
    ? 'bg-[linear-gradient(180deg,#001f54_0%,#00163d_100%)] text-white'
    : 'bg-[linear-gradient(180deg,#f8fafc_0%,#e8edf5_100%)] text-slate-900';
  const frameClass = isDark ? 'border-[#0d2d66] bg-[#00163d]' : 'border-slate-300 bg-white';
  const chartPanelClass = isDark ? 'border-white/20 bg-black' : 'border-slate-300 bg-white';

  return (
    <div className={`min-h-full px-3 py-6 sm:px-4 lg:px-6 ${pageClass}`}>
      <div className="mx-auto w-full space-y-4">
        <header className={`rounded-none border px-6 py-4 shadow-sm ${frameClass}`}>
          <div className="grid items-center gap-4 xl:grid-cols-[300px_1fr_300px]">
            <div className={`flex items-center justify-center rounded-2xl border px-4 py-3 ${isDark ? 'border-white/20 bg-white/5' : 'border-slate-300 bg-slate-50'}`}>
              <div className="flex items-center gap-4">
                <div className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl ${isDark ? 'bg-white' : 'bg-slate-100'}`}>
                  {companyLogo ? <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" /> : <Building2 className="h-7 w-7 text-slate-400" />}
                </div>
                <div>
                  <div className={`text-xl font-black uppercase ${isDark ? 'text-white' : 'text-slate-900'}`}>{companyName}</div>
                  <div className={`text-xs font-bold uppercase tracking-[0.18em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>Posição financeira</div>
                </div>
              </div>
            </div>

            <div className="text-center">
              <h1 className={`text-4xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Boletim<span className={`font-light ${isDark ? 'text-white/80' : 'text-slate-500'}`}>financeiro</span>
              </h1>
            </div>

            <div className={`flex items-center justify-center rounded-2xl border px-4 py-3 ${isDark ? 'border-white/20 bg-white/5' : 'border-slate-300 bg-slate-50'}`}>
              <div className="flex items-center gap-3">
                <CalendarDays className={`h-5 w-5 ${isDark ? 'text-white/60' : 'text-slate-500'}`} />
                <div>
                  <div className={`text-xs font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>Data base</div>
                  <div className={`text-lg font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{now.toLocaleDateString('pt-BR')}</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_520px]">
          <MetricGrid
            title="Contas a pagar"
            accent="rose"
            isDark={isDark}
            metrics={[
              { label: 'Para hoje', value: boletim.pagar.hoje },
              { label: 'Para amanhã', value: boletim.pagar.amanha },
              { label: 'Atrasadas', value: boletim.pagar.atrasadas },
              { label: 'Total do mês', value: boletim.pagar.totalMes },
              { label: 'Realizadas', value: boletim.pagar.realizadas },
              { label: 'Em aberto', value: boletim.pagar.emAberto },
            ]}
          />

          <MetricGrid
            title="Contas a receber"
            accent="cyan"
            isDark={isDark}
            metrics={[
              { label: 'Para hoje', value: boletim.receber.hoje },
              { label: 'Para amanhã', value: boletim.receber.amanha },
              { label: 'Atrasadas', value: boletim.receber.atrasadas },
              { label: 'Total do mês', value: boletim.receber.totalMes },
              { label: 'Realizadas', value: boletim.receber.realizadas },
              { label: 'Em aberto', value: boletim.receber.emAberto },
            ]}
          />

          <section className={`border px-4 py-4 ${isDark ? 'border-amber-400/45 bg-black' : 'border-amber-300 bg-white'}`}>
            <h2 className="mb-4 text-center text-2xl font-black uppercase tracking-[0.04em] text-amber-400">Resultados</h2>

            <div className={`overflow-hidden border ${isDark ? 'border-white/25' : 'border-slate-300'}`}>
              <table className="w-full text-left text-sm">
                <thead className={isDark ? 'bg-amber-300 text-slate-950' : 'bg-amber-200 text-slate-900'}>
                  <tr>
                    <th className="px-3 py-2 font-black">Banco</th>
                    <th className="px-3 py-2 text-right font-black">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {boletim.bancos.map((conta) => {
                    const bankBrand = inferBankBrand(conta.banco, conta.nome, conta.tipo);
                    return (
                      <tr key={conta.id} className={isDark ? 'border-t border-white/10 text-white' : 'border-t border-slate-200 text-slate-800'}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <BrandAvatar visual={bankBrand} size="sm" />
                            <span>{conta.banco || conta.nome}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{BRL.format(Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0))}</td>
                      </tr>
                    );
                  })}
                  <tr className={isDark ? 'border-t border-white/20 text-white' : 'border-t border-slate-300 text-slate-900'}>
                    <td className="px-3 py-3 font-black">Total geral</td>
                    <td className="px-3 py-3 text-right font-black">{BRL.format(boletim.saldoBancario)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <ResultChip label="Operacional" value={boletim.operacional} isDark={isDark} />
              <ResultChip label="Final" value={boletim.final} isDark={isDark} />
              <ResultChip label="A receber" value={boletim.aReceberAberto} isDark={isDark} />
              <ResultChip label="Endividamento" value={boletim.endividamento} isDark={isDark} />
            </div>
          </section>

          <section className={`border px-4 py-4 xl:col-span-2 ${chartPanelClass}`}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>Histórico de contas a pagar e a receber no vencimento</h3>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-red-500"><TrendingDown className="h-4 w-4" />Pagamento</span>
                <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-blue-500"><TrendingUp className="h-4 w-4" />Recebimento</span>
              </div>
            </div>
            <AsyncApexChart type="bar" height={320} series={chartSeries} options={chartOptions} />
          </section>
        </section>
      </div>
    </div>
  );
}
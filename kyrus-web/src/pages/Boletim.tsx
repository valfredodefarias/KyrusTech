import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, Landmark, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

import { AsyncApexChart } from '../components/AsyncApexChart';
import { BrandAvatar, inferBankBrand } from '../components/BrandAvatar';
import { api } from '../services/api';

interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
  tipo: string;
  logo_url?: string | null;
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
  conta_id?: number | null;
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

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

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
  if (url.startsWith('http://') && url.includes('/static/')) {
    try {
      const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
      const path = new URL(url).pathname;
      return `${baseURL}${path}`;
    } catch {
      return url;
    }
  }
  return url;
}

function SummaryPanel({
  title,
  accent,
  metrics,
}: {
  title: string;
  accent: 'rose' | 'emerald' | 'sky';
  metrics: Array<{ label: string; value: number; tone?: 'positive' | 'negative' | 'neutral' }>;
}) {
  const accentClass = {
    rose: 'border-rose-500/30 bg-[linear-gradient(180deg,rgba(244,63,94,0.14),rgba(15,23,42,0.78))]',
    emerald: 'border-emerald-500/30 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(15,23,42,0.78))]',
    sky: 'border-sky-500/30 bg-[linear-gradient(180deg,rgba(14,165,233,0.14),rgba(15,23,42,0.78))]',
  }[accent];

  return (
    <section className={`rounded-[28px] border p-5 text-white shadow-[0_25px_80px_-60px_rgba(2,6,23,0.95)] ${accentClass}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-black uppercase tracking-[0.24em] text-white/92">{title}</h2>
      </div>

      <div className="space-y-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/3 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/58">{metric.label}</span>
            <span className={`text-sm font-black ${metric.tone === 'positive' ? 'text-emerald-300' : metric.tone === 'negative' ? 'text-rose-300' : 'text-white'}`}>
              {BRL.format(metric.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoChip({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/4 px-4 py-3 text-white">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white/70">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">{label}</p>
          <p className="mt-1 text-lg font-black text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

export function Boletim() {
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);

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
      const hoje = items
        .filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) === todayIso)
        .reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);

      const amanha = items
        .filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) === tomorrowIso)
        .reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);

      const atrasadas = items
        .filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) < todayIso)
        .reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);

      const emAberto = items
        .filter((item) => !isPago(item.status))
        .reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);

      const realizadas = items
        .filter((item) => isPago(item.status))
        .reduce((acc, item) => acc + Number(item.valor_pago ?? item.valor_previsto ?? 0), 0);

      const totalMes = items
        .filter((item) => {
          const due = parseDateOnly(item.data_vencimento);
          return due && due >= monthStart && due <= monthEnd;
        })
        .reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);

      return { hoje, amanha, atrasadas, emAberto, realizadas, totalMes };
    };

    const pagar = makeBlock(payables);
    const receber = makeBlock(receivables);

    const saldoBancario = contas.reduce((acc, conta) => acc + Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0), 0);
    const saldoTransferencia = receber.emAberto - pagar.emAberto;
    const resultadoRealizado = receber.realizadas - pagar.realizadas;
    const resultadoProjetado = receber.totalMes - pagar.totalMes;

    const saldosOrdenados = [...contas].sort((left, right) => Number(right.saldo_atual ?? right.saldo_inicial ?? 0) - Number(left.saldo_atual ?? left.saldo_inicial ?? 0));

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

    return {
      pagar,
      receber,
      saldoBancario,
      saldoTransferencia,
      resultadoRealizado,
      resultadoProjetado,
      bancos: saldosOrdenados,
      chartReceber,
      chartPagar,
    };
  }, [contas, lancamentos]);

  const chartOptions = useMemo<any>(() => ({
    chart: {
      toolbar: { show: false },
      foreColor: '#94a3b8',
      background: 'transparent',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    stroke: { curve: 'smooth', width: [3, 3] },
    colors: ['#34d399', '#fb7185'],
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      labels: { colors: '#cbd5e1' },
    },
    grid: { borderColor: 'rgba(148, 163, 184, 0.12)' },
    xaxis: {
      categories: MONTH_SHORT,
      labels: { style: { colors: Array.from({ length: 12 }, () => '#94a3b8') } },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => BRL.format(value),
        style: { colors: ['#94a3b8'] },
      },
    },
    tooltip: {
      theme: 'dark',
      y: { formatter: (value: number) => BRL.format(value) },
    },
  }), []);

  const chartSeries = useMemo(() => ([
    { name: 'Contas a receber', data: boletim.chartReceber },
    { name: 'Contas a pagar', data: boletim.chartPagar },
  ]), [boletim.chartPagar, boletim.chartReceber]);

  const primaryColor = empresa?.cor_primaria || '#0ea5e9';
  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';
  const now = new Date();

  if (loading) {
    return <div className="p-10 text-center text-slate-400">Carregando boletim...</div>;
  }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.15),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_45%,#111827_100%)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <header className="rounded-[34px] border border-white/10 bg-slate-950/70 px-6 py-6 shadow-[0_35px_120px_-70px_rgba(2,6,23,1)] backdrop-blur md:px-8">
          <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_0.8fr] xl:items-center">
            <div className="flex items-center gap-4 rounded-[28px] border border-white/10 bg-white/3 px-5 py-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                {companyLogo ? (
                  <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="h-8 w-8 text-white/35" />
                )}
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/35">Empresa</p>
                <h1 className="mt-2 text-2xl font-black text-white">{companyName}</h1>
                <p className="mt-1 text-sm text-white/48">{empresa?.razao_social || 'Posicao financeira consolidada'}</p>
              </div>
            </div>

            <div className="text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.36em] text-white/35">Boletim financeiro</p>
              <h2 className="mt-3 text-3xl font-black tracking-[0.14em] text-white md:text-4xl">BOLETIM</h2>
              <p className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/45">{MONTH_SHORT[now.getMonth()]} {now.getFullYear()}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <InfoChip label="Saldo bancario" value={BRL.format(boletim.saldoBancario)} icon={Wallet} />
              <InfoChip label="Data base" value={now.toLocaleDateString('pt-BR')} icon={CalendarDays} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-3">
          <SummaryPanel
            title="Contas a pagar"
            accent="rose"
            metrics={[
              { label: 'Hoje', value: boletim.pagar.hoje, tone: 'negative' },
              { label: 'Amanha', value: boletim.pagar.amanha, tone: 'negative' },
              { label: 'Atrasadas', value: boletim.pagar.atrasadas, tone: 'negative' },
              { label: 'Em aberto', value: boletim.pagar.emAberto, tone: 'negative' },
              { label: 'Realizadas', value: boletim.pagar.realizadas },
              { label: 'Total do mes', value: boletim.pagar.totalMes },
            ]}
          />

          <SummaryPanel
            title="Contas a receber"
            accent="emerald"
            metrics={[
              { label: 'Hoje', value: boletim.receber.hoje, tone: 'positive' },
              { label: 'Amanha', value: boletim.receber.amanha, tone: 'positive' },
              { label: 'Atrasadas', value: boletim.receber.atrasadas, tone: 'positive' },
              { label: 'Em aberto', value: boletim.receber.emAberto, tone: 'positive' },
              { label: 'Realizadas', value: boletim.receber.realizadas },
              { label: 'Total do mes', value: boletim.receber.totalMes },
            ]}
          />

          <SummaryPanel
            title="Resultados"
            accent="sky"
            metrics={[
              { label: 'Saldo bancario', value: boletim.saldoBancario, tone: boletim.saldoBancario >= 0 ? 'positive' : 'negative' },
              { label: 'Saldo transferencia', value: boletim.saldoTransferencia, tone: boletim.saldoTransferencia >= 0 ? 'positive' : 'negative' },
              { label: 'Resultado realizado', value: boletim.resultadoRealizado, tone: boletim.resultadoRealizado >= 0 ? 'positive' : 'negative' },
              { label: 'Resultado projetado', value: boletim.resultadoProjetado, tone: boletim.resultadoProjetado >= 0 ? 'positive' : 'negative' },
              { label: 'Recebimentos', value: boletim.receber.totalMes, tone: 'positive' },
              { label: 'Pagamentos', value: boletim.pagar.totalMes, tone: 'negative' },
            ]}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-4xl border border-white/10 bg-slate-950/65 p-5 shadow-[0_30px_100px_-70px_rgba(2,6,23,1)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/35">Bancos</p>
                <h3 className="mt-2 text-xl font-black text-white">Saldos</h3>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/4 p-3 text-white/55">
                <Landmark className="h-5 w-5" />
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/4 text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
                  <tr>
                    <th className="px-4 py-3">Banco</th>
                    <th className="px-4 py-3">Conta</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {boletim.bancos.slice(0, 10).map((conta) => {
                    const saldo = Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0);
                    const bankBrand = inferBankBrand(conta.banco, conta.nome, conta.tipo);

                    return (
                      <tr key={conta.id} className="border-t border-white/8 bg-white/2">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <BrandAvatar visual={bankBrand} size="sm" />
                            <span className="font-semibold text-white/72">{conta.banco || conta.tipo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-white">{conta.nome}</td>
                        <td className={`px-4 py-3 text-right font-black ${saldo >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {BRL.format(saldo)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-4xl border border-white/10 bg-slate-950/65 p-5 shadow-[0_30px_100px_-70px_rgba(2,6,23,1)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/35">Historico</p>
                <h3 className="mt-2 text-xl font-black text-white">Contas a pagar e a receber no vencimento</h3>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
                <TrendingUp className="h-4 w-4 text-emerald-300" />
                <TrendingDown className="h-4 w-4 text-rose-300" />
              </div>
            </div>

            <AsyncApexChart type="line" height={320} series={chartSeries} options={chartOptions} />
          </div>
        </section>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-32 bg-linear-to-t from-slate-950 to-transparent" />
      <div className="pointer-events-none fixed right-8 top-8 hidden h-40 w-40 rounded-full blur-3xl lg:block" style={{ backgroundColor: `${primaryColor}22` }} />
    </div>
  );
}
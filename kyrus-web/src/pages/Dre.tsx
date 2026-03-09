import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

import { AsyncApexChart } from '../components/AsyncApexChart';
import { api } from '../services/api';

interface DRECategoriaItem {
  plano_contas_id: number | null;
  nome: string;
  codigo?: string | null;
  tipo: string;
  total: number;
}

interface DRESerieItem {
  competencia: string;
  receitas: number;
  despesas: number;
  resultado: number;
}

interface DREPayload {
  ano: number;
  mes: number;
  competencia_label: string;
  receita_total: number;
  despesa_total: number;
  resultado_total: number;
  margem_percentual: number;
  categorias_receita: DRECategoriaItem[];
  categorias_despesa: DRECategoriaItem[];
  serie_mensal: DRESerieItem[];
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function MetricCard({
  title,
  value,
  tone,
  icon,
}: {
  title: string;
  value: string;
  tone: 'emerald' | 'rose' | 'slate';
  icon: React.ReactNode;
}) {
  const toneClass = {
    emerald: 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200',
    rose: 'border-rose-200/70 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200',
    slate: 'border-slate-200/70 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100',
  }[tone];

  return (
    <div className={`rounded-[26px] border p-5 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] opacity-70">{title}</p>
          <p className="mt-3 text-2xl font-black tracking-tight">{value}</p>
        </div>
        <div className="rounded-2xl border border-current/10 bg-white/60 p-3 dark:bg-white/5">{icon}</div>
      </div>
    </div>
  );
}

export function Dre() {
  const now = useMemo(() => new Date(), []);
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DREPayload | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get<DREPayload>('/dre/', { params: { ano, mes } });
        if (!active) return;
        setData(response.data);
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.detail || 'Nao foi possivel carregar a DRE.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [ano, mes]);

  const chartSeries = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'Receitas', data: data.serie_mensal.map((item) => item.receitas) },
      { name: 'Despesas', data: data.serie_mensal.map((item) => item.despesas) },
      { name: 'Resultado', data: data.serie_mensal.map((item) => item.resultado) },
    ];
  }, [data]);

  const chartOptions = useMemo(() => ({
    chart: {
      toolbar: { show: false },
      foreColor: '#94a3b8',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    stroke: { curve: 'smooth', width: [3, 3, 4] },
    colors: ['#10b981', '#f43f5e', '#0f172a'],
    grid: { borderColor: 'rgba(148, 163, 184, 0.15)' },
    xaxis: {
      categories: data?.serie_mensal.map((item) => item.competencia) || [],
      labels: { rotate: -35 },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => moneyFormatter.format(value),
      },
    },
    tooltip: {
      y: {
        formatter: (value: number) => moneyFormatter.format(value),
      },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'left',
    },
  }), [data]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.10),transparent_22%)] px-4 py-6 text-slate-900 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_48%,#cbd5e1_100%)] p-6 shadow-[0_30px_90px_-50px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,#020617_0%,#0f172a_48%,#111827_100%)] md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">KyrusTECH</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">DRE gerencial</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                Leitura mensal de receitas, despesas e margem com abertura por categoria e historico consolidado dos ultimos 12 meses.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/50 bg-white/75 p-5 backdrop-blur dark:border-white/10 dark:bg-white/5">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Competencia</label>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <select
                  value={mes}
                  onChange={(e) => setMes(Number(e.target.value))}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  {MONTHS.map((label, index) => (
                    <option key={label} value={index + 1}>{label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={ano}
                  onChange={(e) => setAno(Number(e.target.value) || now.getFullYear())}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <CalendarDays className="h-4 w-4" />
                {data?.competencia_label || `${MONTHS[mes - 1]}/${ano}`}
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <MetricCard title="Receita" value={moneyFormatter.format(data?.receita_total || 0)} tone="emerald" icon={<TrendingUp className="h-6 w-6" />} />
          <MetricCard title="Despesa" value={moneyFormatter.format(data?.despesa_total || 0)} tone="rose" icon={<TrendingDown className="h-6 w-6" />} />
          <MetricCard
            title="Resultado"
            value={`${moneyFormatter.format(data?.resultado_total || 0)} • ${percentFormatter.format(data?.margem_percentual || 0)}%`}
            tone="slate"
            icon={<Wallet className="h-6 w-6" />}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
          <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Historico</p>
                <h2 className="mt-2 text-xl font-black tracking-tight">Serie mensal da operacao</h2>
              </div>
            </div>
            <div className="mt-6">
              {loading ? (
                <div className="flex h-80 items-center justify-center rounded-3xl border border-dashed border-slate-200 text-sm font-semibold text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  Carregando DRE...
                </div>
              ) : (
                <AsyncApexChart type="line" height={320} series={chartSeries} options={chartOptions} />
              )}
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Resumo</p>
            <h2 className="mt-2 text-xl font-black tracking-tight">Leitura do mes</h2>
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Receita liquida gerencial</p>
                <p className="mt-3 text-2xl font-black text-emerald-600 dark:text-emerald-300">{moneyFormatter.format(data?.receita_total || 0)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Custo e despesas</p>
                <p className="mt-3 text-2xl font-black text-rose-600 dark:text-rose-300">{moneyFormatter.format(data?.despesa_total || 0)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resultado final</p>
                <p className="mt-3 text-2xl font-black">{moneyFormatter.format(data?.resultado_total || 0)}</p>
                <p className="mt-2 text-sm text-slate-300">Margem de {percentFormatter.format(data?.margem_percentual || 0)}% no periodo selecionado.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Receitas</p>
            <h2 className="mt-2 text-xl font-black tracking-tight">Categorias que sustentam o resultado</h2>
            <div className="mt-6 space-y-3">
              {(data?.categorias_receita || []).slice(0, 8).map((item) => (
                <div key={`receita-${item.plano_contas_id}-${item.nome}`} className="flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{item.nome}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{item.codigo || 'Sem codigo'}</p>
                  </div>
                  <p className="text-sm font-black text-emerald-600 dark:text-emerald-300">{moneyFormatter.format(item.total)}</p>
                </div>
              ))}
              {!loading && !(data?.categorias_receita.length) ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Nenhuma receita contabilizada nesta competencia.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Despesas</p>
            <h2 className="mt-2 text-xl font-black tracking-tight">Categorias que mais pressionam a margem</h2>
            <div className="mt-6 space-y-3">
              {(data?.categorias_despesa || []).slice(0, 8).map((item) => (
                <div key={`despesa-${item.plano_contas_id}-${item.nome}`} className="flex items-center justify-between rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/20">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{item.nome}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{item.codigo || 'Sem codigo'}</p>
                  </div>
                  <p className="text-sm font-black text-rose-600 dark:text-rose-300">{moneyFormatter.format(item.total)}</p>
                </div>
              ))}
              {!loading && !(data?.categorias_despesa.length) ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Nenhuma despesa contabilizada nesta competencia.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
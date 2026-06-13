import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Download, Printer, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../services/api';

interface PdvVendaItem {
  id: number;
  rv: string;
  data: string;
  hora?: string | null;
  vendedor: string;
  status: string;
  descricao: string;
  valor: number;
  origem?: string;
  tipo_venda?: string;
  tipoVenda?: string;
  fonte?: string;
}

interface PdvVendaGrupo {
  data: string;
  total: number;
  quantidade: number;
  vendas: PdvVendaItem[];
}

interface PdvVendasResponse {
  pode_ver_todas: boolean;
  total_vendas: number;
  total_valor: number;
  grupos: PdvVendaGrupo[];
}

function isPdvVenda(venda: PdvVendaItem) {
  const markers = [venda.origem, venda.tipo_venda, venda.tipoVenda, venda.fonte]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());

  return markers.includes('PDV');
}

function normalizePdvResponse(response: PdvVendasResponse): PdvVendasResponse {
  const grupos = (response.grupos || [])
    .map((grupo) => ({
      ...grupo,
      vendas: (grupo.vendas || []).filter(isPdvVenda),
    }))
    .filter((grupo) => grupo.vendas.length > 0);

  const totalVendas = grupos.reduce((sum, grupo) => sum + grupo.vendas.length, 0);
  const totalValor = grupos.reduce((sum, grupo) => sum + grupo.vendas.reduce((grupoSum, venda) => grupoSum + Number(venda.valor || 0), 0), 0);

  return {
    ...response,
    grupos,
    total_vendas: totalVendas,
    total_valor: totalValor,
  };
}

export function PDVFechamento() {
  const [data, setData] = useState<PdvVendasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get<PdvVendasResponse>('/pdv/vendas');
        if (active) {
          if (response.data && typeof response.data === 'object' && 'error' in response.data) {
            setData(null);
            setError(String((response.data as { error?: string }).error || 'Não foi possível gerar o dossiê de fechamento.'));
          } else {
            setData(normalizePdvResponse(response.data));
          }
        }
      } catch (err: any) {
        if (active) {
          setError(err?.response?.data?.detail || 'Não foi possível gerar o dossiê de fechamento.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  const currency = useMemo(() => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }), []);
  const totalVendas = data?.total_vendas ?? 0;
  const totalValor = data?.total_valor ?? 0;
  const totalDias = data?.grupos?.length ?? 0;
  const totalMedio = totalVendas > 0 ? totalValor / totalVendas : 0;

  return (
    <div className="space-y-6 pb-8">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white shadow-sm dark:border-slate-700">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-white/80 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5" />
              PDV / Fechamento
            </p>
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Dossiê de fechamento do PDV</h1>
              <p className="mt-3 max-w-xl text-sm text-white/75 sm:text-base">
                Este dossiê ficou fora de Lançamentos e consolida apenas vendas marcadas como PDV. Se não houver venda, ele não inventa número.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:max-w-2xl">
            <SummaryCard title="Vendas" value={String(totalVendas)} subtitle="Registros de PDV" />
            <SummaryCard title="Total" value={currency.format(totalValor)} subtitle="Faturamento bruto" />
            <SummaryCard title="Dias" value={String(totalDias)} subtitle="Dias com venda" />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">Resumo</p>
            <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">Visão executiva para o fechamento</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use para imprimir, conferir e levar para conferência final do caixa.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900">
              <Printer className="h-4 w-4" />
              Imprimir
            </button>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <Link to="/pdv" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              Voltar ao PDV
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900">Gerando dossiê de fechamento...</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">Não foi possível gerar o dossiê</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        </div>
      ) : totalVendas > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <InfoCard title="Média por venda" value={currency.format(totalMedio)} description="Total dividido pelo número de vendas" />
            <InfoCard title="Total de dias" value={String(totalDias)} description="Agrupamento por data" />
            <InfoCard title="Status" value="Fechamento pronto" description="Não é mais uma página de Lançamentos" />
          </div>

          {data?.grupos.map((grupo) => (
            <section key={String(grupo.data)} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <div>
                  <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {new Date(`${grupo.data}T00:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'full' })}
                  </p>
                  <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{grupo.quantidade} venda{grupo.quantidade === 1 ? '' : 's'}</h3>
                </div>
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-right dark:bg-slate-800">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Total do dia</p>
                  <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{currency.format(grupo.total)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed text-left">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="w-28 px-4 py-3">RV</th>
                      <th className="px-4 py-3">Descrição</th>
                      <th className="w-56 px-4 py-3">Vendedor</th>
                      <th className="w-28 px-4 py-3 text-center">Status</th>
                      <th className="w-32 px-4 py-3 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {grupo.vendas.map((venda) => (
                      <tr key={venda.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 align-top text-sm font-bold text-slate-900 dark:text-white">{venda.rv}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold text-slate-900 dark:text-white">{venda.descricao}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Hora {venda.hora || '--:--'} • ID {venda.id}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-slate-700 dark:text-slate-200">{venda.vendedor}</td>
                        <td className="px-4 py-3 align-top text-center"><span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{venda.status}</span></td>
                        <td className="px-4 py-3 align-top text-right text-sm font-black text-slate-900 dark:text-white">{currency.format(venda.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Dossiê vazio</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Sem vendas marcadas como PDV, não há fechamento para montar.</p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4 backdrop-blur-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">{title}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs text-white/65">{subtitle}</p>
    </div>
  );
}

function InfoCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-500">{title}</p>
      <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}
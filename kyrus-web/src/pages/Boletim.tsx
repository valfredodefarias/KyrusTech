import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarRange, Landmark, ListFilter, ReceiptText, Wallet } from 'lucide-react';
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

type ModoBoletim = 'compacto' | 'detalhado';

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isReceita(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('R');
}

export function Boletim() {
  const [loading, setLoading] = useState(true);
  const [modo, setModo] = useState<ModoBoletim>('compacto');
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [contasRes, lancamentosRes] = await Promise.all([
          api.get<ContaResumo[]>('/contas/'),
          api.get<LancamentoResumo[]>('/lancamentos/', { params: { limit: 400 } }),
        ]);

        setContas(contasRes.data || []);
        setLancamentos(lancamentosRes.data || []);
      } catch (error) {
        console.error('Erro ao carregar boletim', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const boletim = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const next7 = new Date(today);
    next7.setDate(today.getDate() + 7);

    const saldoTotal = contas.reduce((acc, conta) => acc + Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0), 0);

    const pagasNoMes = lancamentos.filter((item) => {
      const pagamento = parseDateOnly(item.data_pagamento);
      return pagamento && pagamento >= monthStart && pagamento <= today;
    });

    const abertasProximas = lancamentos.filter((item) => {
      const vencimento = parseDateOnly(item.data_vencimento);
      return item.status !== 'PAGO' && vencimento && vencimento >= today && vencimento <= next7;
    });

    const entradasMes = pagasNoMes
      .filter((item) => isReceita(item.tipo))
      .reduce((acc, item) => acc + Number(item.valor_pago ?? item.valor_previsto ?? 0), 0);

    const saidasMes = pagasNoMes
      .filter((item) => !isReceita(item.tipo))
      .reduce((acc, item) => acc + Number(item.valor_pago ?? item.valor_previsto ?? 0), 0);

    const lancamentosOrdenados = [...lancamentos].sort((a, b) => {
      const aDate = parseDateOnly(a.data_pagamento || a.data_vencimento)?.getTime() || 0;
      const bDate = parseDateOnly(b.data_pagamento || b.data_vencimento)?.getTime() || 0;
      return bDate - aDate;
    });

    return {
      saldoTotal,
      entradasMes,
      saidasMes,
      abertasProximas,
      recentes: lancamentosOrdenados.slice(0, modo === 'compacto' ? 8 : 16),
      contasOrdenadas: [...contas].sort((a, b) => Number(b.saldo_atual ?? b.saldo_inicial ?? 0) - Number(a.saldo_atual ?? a.saldo_inicial ?? 0)),
    };
  }, [contas, lancamentos, modo]);

  if (loading) {
    return <div className="p-10 text-center text-slate-500">Carregando boletim...</div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10">
      <header className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_48%,#e2e8f0_100%)] p-6 shadow-sm dark:border-slate-700 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(30,41,59,0.96)_100%)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Boletim financeiro</p>
            <h1 className="mt-2 text-3xl font-black text-slate-900 dark:text-white">Leitura direta do caixa, bancos e próximos movimentos</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-300">
              Esta página substitui a navegação pelo dashboard antigo para o uso diário. O foco aqui é leitura prática: saldo, entradas, saídas, vencimentos próximos e bancos mais relevantes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              <button type="button" onClick={() => setModo('compacto')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${modo === 'compacto' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 dark:text-slate-300'}`}>
                Compacto
              </button>
              <button type="button" onClick={() => setModo('detalhado')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${modo === 'detalhado' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 dark:text-slate-300'}`}>
                Detalhado
              </button>
            </div>

            <Link to="/lancamentos" className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
              Ver lançamentos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Wallet} label="Saldo consolidado" value={BRL.format(boletim.saldoTotal)} support="Posição atual das contas cadastradas" tone={boletim.saldoTotal >= 0 ? 'emerald' : 'rose'} />
        <MetricCard icon={Landmark} label="Entradas pagas no mês" value={BRL.format(boletim.entradasMes)} support="Recebimentos já efetivados" tone="cyan" />
        <MetricCard icon={ReceiptText} label="Saídas pagas no mês" value={BRL.format(boletim.saidasMes)} support="Pagamentos já baixados" tone="amber" />
        <MetricCard icon={CalendarRange} label="A vencer em 7 dias" value={String(boletim.abertasProximas.length)} support="Títulos ainda em aberto" tone="violet" />
      </section>

      <section className={`grid gap-6 ${modo === 'compacto' ? 'xl:grid-cols-[1.2fr_0.8fr]' : 'xl:grid-cols-[1.35fr_0.65fr]'}`}>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Movimentos recentes</p>
              <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">O que acabou de mexer no financeiro</h2>
            </div>
            <Link to="/contas" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/50">
              Abrir extratos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-180 text-left">
              <thead className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-3">Data</th>
                  <th className="px-3 py-3">Descrição</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-3 py-3">Tipo</th>
                  <th className="px-3 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                {boletim.recentes.map((item) => {
                  const valor = Number(item.status === 'PAGO' ? item.valor_pago ?? item.valor_previsto : item.valor_previsto);
                  const positive = isReceita(item.tipo);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">{(item.data_pagamento || item.data_vencimento || '').slice(0, 10)}</td>
                      <td className="px-3 py-3 font-semibold text-slate-700 dark:text-slate-200">{item.descricao}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${item.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-300">{positive ? 'Entrada' : 'Saída'}</td>
                      <td className={`px-3 py-3 text-right font-black ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>{positive ? '+' : '-'} {BRL.format(valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Bancos</p>
                <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">Maiores saldos agora</h2>
              </div>
              <ListFilter className="h-4 w-4 text-slate-400" />
            </div>

            <div className="space-y-3">
              {boletim.contasOrdenadas.slice(0, modo === 'compacto' ? 5 : 8).map((conta) => {
                const saldo = Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0);
                const bankBrand = inferBankBrand(conta.banco, conta.nome, conta.tipo);

                return (
                  <div key={conta.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex min-w-0 items-center gap-3">
                      <BrandAvatar visual={bankBrand} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{conta.nome}</p>
                        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{conta.banco || conta.tipo}</p>
                      </div>
                    </div>
                    <p className={`text-sm font-black ${saldo >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{BRL.format(saldo)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Atenção curta</p>
            <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">Próximos vencimentos</h2>

            <div className="mt-4 space-y-3">
              {boletim.abertasProximas.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
                  Nenhum título em aberto vence nos próximos 7 dias.
                </div>
              ) : (
                boletim.abertasProximas.slice(0, modo === 'compacto' ? 4 : 8).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.descricao}</p>
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Vence em {(item.data_vencimento || '').slice(0, 10)}</p>
                      </div>
                      <p className={`text-sm font-black ${isReceita(item.tipo) ? 'text-emerald-600' : 'text-rose-600'}`}>{BRL.format(Number(item.valor_previsto || 0))}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, support, tone }: { icon: any; label: string; value: string; support: string; tone: 'emerald' | 'rose' | 'cyan' | 'amber' | 'violet' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
    rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/20',
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
    violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20',
  };

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.2em]">{label}</p>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 text-2xl font-black">{value}</p>
      <p className="mt-2 text-sm opacity-80">{support}</p>
    </div>
  );
}
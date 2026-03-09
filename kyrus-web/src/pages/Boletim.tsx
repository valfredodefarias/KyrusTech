import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, CalendarRange, Landmark, ReceiptText, Wallet } from 'lucide-react';
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
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
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
          api.get<LancamentoResumo[]>('/lancamentos/', { params: { limit: 400 } }),
        ]);

        setEmpresa(empresaAtual);
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
      resultadoMes: entradasMes - saidasMes,
      abertasProximas,
      recentes: lancamentosOrdenados.slice(0, modo === 'compacto' ? 8 : 16),
      contasOrdenadas: [...contas].sort((a, b) => Number(b.saldo_atual ?? b.saldo_inicial ?? 0) - Number(a.saldo_atual ?? a.saldo_inicial ?? 0)),
    };
  }, [contas, lancamentos, modo]);

  const primaryColor = empresa?.cor_primaria || '#2563eb';
  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';
  const companySubtitle = empresa?.razao_social || 'Painel financeiro executivo';

  if (loading) {
    return <div className="p-10 text-center text-slate-500">Carregando boletim...</div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10">
      <header className="overflow-hidden rounded-4xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                {companyLogo ? (
                  <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <Building2 className="h-7 w-7" />
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">KyrusTECH</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{companyName}</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{companySubtitle}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={() => setModo('compacto')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${modo === 'compacto' ? 'text-white' : 'text-slate-500 dark:text-slate-300'}`} style={modo === 'compacto' ? { backgroundColor: primaryColor } : undefined}>
                  Compacto
                </button>
                <button type="button" onClick={() => setModo('detalhado')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${modo === 'detalhado' ? 'text-white' : 'text-slate-500 dark:text-slate-300'}`} style={modo === 'detalhado' ? { backgroundColor: primaryColor } : undefined}>
                  Detalhado
                </button>
              </div>

              <Link to="/lancamentos" className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-white transition hover:opacity-90" style={{ backgroundColor: primaryColor }}>
                Ver lançamentos
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[28px] bg-slate-950 px-6 py-6 text-white" style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #0f172a 72%)` }}>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/60">Boletim financeiro</p>
            <h2 className="mt-3 text-3xl font-black leading-tight">Leitura rápida do caixa e dos próximos movimentos</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/78">
              Um resumo limpo do que entrou, saiu, vence em seguida e onde está concentrado o saldo da empresa agora.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Saldo total" value={BRL.format(boletim.saldoTotal)} tone={boletim.saldoTotal >= 0 ? 'positive' : 'negative'} />
            <HeroStat label="Resultado do mês" value={BRL.format(boletim.resultadoMes)} tone={boletim.resultadoMes >= 0 ? 'positive' : 'negative'} />
            <HeroStat label="Entradas pagas" value={BRL.format(boletim.entradasMes)} tone="neutral" />
            <HeroStat label="Saídas pagas" value={BRL.format(boletim.saidasMes)} tone="neutral" />
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Wallet} label="Saldo consolidado" value={BRL.format(boletim.saldoTotal)} support="Posição total das contas da empresa" tone={boletim.saldoTotal >= 0 ? 'emerald' : 'rose'} />
        <MetricCard icon={Landmark} label="Entradas no mês" value={BRL.format(boletim.entradasMes)} support="Recebimentos pagos no período" tone="cyan" />
        <MetricCard icon={ReceiptText} label="Saídas no mês" value={BRL.format(boletim.saidasMes)} support="Pagamentos baixados no período" tone="amber" />
        <MetricCard icon={CalendarRange} label="Próximos vencimentos" value={String(boletim.abertasProximas.length)} support="Títulos em aberto nos próximos 7 dias" tone="violet" />
      </section>

      <section className={`grid gap-6 ${modo === 'compacto' ? 'xl:grid-cols-[1.12fr_0.88fr]' : 'xl:grid-cols-[1.25fr_0.75fr]'}`}>
        <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Movimentos recentes</p>
              <h2 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">O que acabou de mexer no financeiro</h2>
            </div>
            <Link to="/contas" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/50">
              Abrir extratos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-700">
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
          <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Bancos</p>
              <h2 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">Saldos por conta</h2>
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

          <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Agenda curta</p>
            <h2 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">Próximos vencimentos</h2>

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

function HeroStat({ label, value, tone }: { label: string; value: string; tone: 'positive' | 'negative' | 'neutral' }) {
  const toneClass = tone === 'positive'
    ? 'text-emerald-600 dark:text-emerald-300'
    : tone === 'negative'
      ? 'text-rose-600 dark:text-rose-300'
      : 'text-slate-900 dark:text-white';

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
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
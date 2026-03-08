import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { 
  PlusCircle, BarChart2, Users, Landmark, 
  CreditCard, Settings, Wallet, Banknote, Home as HomeIcon,
  ClipboardList, Circle, CheckCircle2, Play, Check,
  Activity, ArrowRight, Building2, FileCog, Link as LinkIcon, ShieldCheck
} from 'lucide-react';

interface ContaResumo {
  id: number;
  nome: string;
  tipo: string;
  logo_url?: string | null;
  saldo_inicial: number;
  saldo_atual?: number; 
}

interface UserInfo {
  email: string;
  empresa_id: number;
  nome?: string | null;
  foto_url?: string | null;
}

interface EmpresaInfo {
  nome_fantasia: string;
  razao_social: string;
  cor_primaria?: string; // Adicionado campo de cor
}

interface TodoItem {
  id: number;
  titulo: string;
  descricao?: string | null;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | string;
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | string;
  due_date?: string | null;
  empresa_id?: number | null;
  consultor_id?: number | null;
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
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const resUser = await api.get<UserInfo>('/usuarios/me');
        setUser(resUser.data);

        if (resUser.data.empresa_id) {
          const resEmpresa = await api.get<EmpresaInfo>(`/empresas/${resUser.data.empresa_id}`);
          setEmpresa(resEmpresa.data);
        }

        const resContas = await api.get<ContaResumo[]>('/contas/');
        setContas(resContas.data);

        const resTodos = await api.get<TodoItem[]>('/todos/me');
        setTodos(resTodos.data);

      } catch (error) {
        console.error("Erro ao carregar home:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  
  // Se saldo_atual existir (calculado pelo backend), usa ele. Senão usa o inicial.
  const getSaldo = (c: ContaResumo) => c.saldo_atual !== undefined ? Number(c.saldo_atual) : Number(c.saldo_inicial);

  const saldoTotal = contas.reduce((acc, c) => acc + getSaldo(c), 0);
  const nomeUsuario = user?.nome || user?.email.split('@')[0] || 'Consultor';
  
  // Definição da Cor Dinâmica (Se não tiver no banco, usa azul padrão)
  const primaryColor = empresa?.cor_primaria || '#2563eb'; 
  const bgStyle = {
    background: `linear-gradient(135deg, ${primaryColor} 0%, ${adjustBrightness(primaryColor, -20)} 100%)`
  };

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

  function parseDateOnly(value?: string | null) {
    if (!value) return null;
    const datePart = value.slice(0, 10);
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function isOverdue(todo: TodoItem) {
    const due = parseDateOnly(todo.due_date);
    if (!due) return false;
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return todo.status !== 'CONCLUIDO' && due < today;
  }

  const todoResumo = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const summary = {
      amanha: 0,
      semana: 0,
      futuras: 0,
      atrasadas: 0,
      concluidas_atraso: 0
    };

    todos.forEach(t => {
      const due = parseDateOnly(t.due_date);
      if (t.status !== 'CONCLUIDO') {
        if (due && due.getTime() === tomorrow.getTime()) summary.amanha += 1;
        if (due && due >= today && due <= weekEnd) summary.semana += 1;
        if (due && due > weekEnd) summary.futuras += 1;
        if (isOverdue(t)) summary.atrasadas += 1;
      }
      const finished = parseDateOnly((t as any).finished_at);
      if (t.status === 'CONCLUIDO' && due && finished && finished > due) {
        summary.concluidas_atraso += 1;
      }
    });

    return summary;
  })();

  const tarefasPendentes = todos.filter((t) => t.status !== 'CONCLUIDO').length;
  const tarefasEmAndamento = todos.filter((t) => t.status === 'EM_ANDAMENTO').length;
  const contasPositivas = contas.filter((conta) => getSaldo(conta) >= 0).length;
  const contasNegativas = contas.filter((conta) => getSaldo(conta) < 0).length;
  const operationalShortcuts: AtalhoCardProps[] = [
    {
      to: '/dashboard',
      icon: Activity,
      label: 'Relatórios e KPIs',
      description: 'Abrir leitura financeira detalhada e indicadores interativos.',
      colorClass: 'text-cyan-600',
      bgClass: 'bg-cyan-100 dark:bg-cyan-500/10',
    },
    {
      to: '/tarefas',
      icon: ClipboardList,
      label: 'Tarefas',
      description: 'Gerenciar pendências, execução e acompanhamento operacional.',
      colorClass: 'text-indigo-600',
      bgClass: 'bg-indigo-100 dark:bg-indigo-500/10',
    },
    {
      to: '/centro-custo',
      icon: Building2,
      label: 'Centros de Custo',
      description: 'Organizar estrutura analítica e responsabilização do gasto.',
      colorClass: 'text-amber-600',
      bgClass: 'bg-amber-100 dark:bg-amber-500/10',
    },
    {
      to: '/auditoria',
      icon: ShieldCheck,
      label: 'Auditoria',
      description: 'Ver trilha de ações e mudanças relevantes no sistema.',
      colorClass: 'text-rose-600',
      bgClass: 'bg-rose-100 dark:bg-rose-500/10',
    },
    {
      to: '/importacao',
      icon: FileCog,
      label: 'Importações',
      description: 'Trazer dados externos e revisar processamento financeiro.',
      colorClass: 'text-emerald-600',
      bgClass: 'bg-emerald-100 dark:bg-emerald-500/10',
    },
    {
      to: '/integracoes/asaas',
      icon: LinkIcon,
      label: 'Integrações',
      description: 'Configurar conexões e automações com serviços externos.',
      colorClass: 'text-violet-600',
      bgClass: 'bg-violet-100 dark:bg-violet-500/10',
    },
  ];

  async function iniciarTodo(todoId: number) {
    await api.post(`/todos/${todoId}/iniciar`);
    const resTodos = await api.get<TodoItem[]>('/todos/me');
    setTodos(resTodos.data);
  }

  async function finalizarTodo(todoId: number) {
    await api.post(`/todos/${todoId}/finalizar`);
    const resTodos = await api.get<TodoItem[]>('/todos/me');
    setTodos(resTodos.data);
  }

  if (loading) {
    return <div className="p-10 text-center animate-pulse text-slate-500">Carregando painel...</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 animate-fade-in pb-10">
      
      {/* Header com Data */}
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-700 dark:text-white">
          <HomeIcon className="w-5 h-5" style={{ color: primaryColor }} /> Visão Geral
        </h2>
        <div className="text-sm text-slate-500 dark:text-slate-400 capitalize">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </header>

      {/* Cartão de Boas Vindas (Hero) PERSONALIZAVEL */}
      <div 
        className="relative overflow-hidden rounded-[30px] p-6 text-white shadow-2xl shadow-slate-900/10 transition-colors duration-500 sm:p-8"
        style={bgStyle} // APLICA A COR DO BANCO AQUI
      >
        <div className="pointer-events-none absolute -right-6 top-0 h-full w-1/3 skew-x-12 bg-white/10"></div>
        <div className="pointer-events-none absolute -bottom-10 left-8 h-32 w-32 rounded-full bg-white/10 blur-2xl"></div>
        <div className="relative z-10">
          <div className="mb-2 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-white/20 flex items-center justify-center">
              {getFullLogoUrl(user?.foto_url || null) ? (
                <img src={getFullLogoUrl(user?.foto_url || null) || ''} alt="Usuário" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-white">
                  {(user?.nome || user?.email || 'U').substring(0,2).toUpperCase()}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-extrabold capitalize sm:text-3xl">Olá, {nomeUsuario}!</h1>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-base text-white/90 sm:text-lg">
            Você está gerenciando: 
            <strong className="bg-white/20 px-2 py-0.5 rounded backdrop-blur-sm">
              {empresa?.nome_fantasia || 'Sua Empresa'}
            </strong>
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">
            Esta página agora concentra entrada rápida para operação, governança e acompanhamento financeiro. O objetivo é reduzir navegação lateral e te colocar mais rápido no que exige ação.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeroMetric label="Saldo consolidado" value={BRL.format(saldoTotal)} tone="text-white" />
            <HeroMetric label="Contas ativas" value={String(contas.length)} tone="text-white" />
            <HeroMetric label="Pendências" value={String(tarefasPendentes)} tone="text-white" />
            <HeroMetric label="Em andamento" value={String(tarefasEmAndamento)} tone="text-white" />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/lancamentos" className="bg-white text-slate-800 px-5 py-2.5 rounded-lg font-bold hover:bg-slate-50 transition shadow-sm flex items-center gap-2 w-full sm:w-auto justify-center">
              <PlusCircle size={18} style={{ color: primaryColor }} /> Novo Lançamento
            </Link>
            <Link to="/dashboard" className="bg-black/20 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-black/30 transition flex items-center gap-2 border border-white/20 w-full sm:w-auto justify-center">
              <BarChart2 size={18} /> Ver Relatórios
            </Link>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryPanel title="Caixa em observação" value={BRL.format(saldoTotal)} support={`${contasPositivas} conta(s) positiva(s) e ${contasNegativas} em pressão`} tone={saldoTotal >= 0 ? 'emerald' : 'rose'} />
        <SummaryPanel title="Tarefas abertas" value={String(tarefasPendentes)} support={`${todoResumo.atrasadas} atrasada(s) e ${todoResumo.amanha} para amanhã`} tone={todoResumo.atrasadas > 0 ? 'amber' : 'indigo'} />
        <SummaryPanel title="Carteira bancária" value={String(contas.length)} support="Contas correntes, caixas e saldos em uso" tone="cyan" />
        <SummaryPanel title="Cadência operacional" value={String(todoResumo.semana)} support="Entregas previstas nos próximos 7 dias" tone="violet" />
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.08),transparent_35%),linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.92)_100%)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Central de operação</p>
            <h3 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">Áreas que saíram do sidebar ficam acessíveis daqui</h3>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-300">Tarefas, auditoria, importações, integrações e centros de custo continuam a um clique, mas agora agrupados dentro da Visão Geral.</p>
          </div>
          <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
            Ver análise completa
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {operationalShortcuts.map((shortcut) => (
            <AtalhoCard key={shortcut.to} {...shortcut} />
          ))}
        </div>
      </section>

      {/* Tarefas */}
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
          <ClipboardList className="w-5 h-5 text-slate-400" /> Minhas Tarefas
        </h3>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-[11px] text-slate-500">Amanhã</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.amanha}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-[11px] text-slate-500">Na semana</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.semana}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-[11px] text-slate-500">Futuras</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.futuras}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-[11px] text-slate-500">Atrasadas</p>
            <p className="text-xl font-bold text-red-600">{todoResumo.atrasadas}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-[11px] text-slate-500">Concl. em atraso</p>
            <p className="text-xl font-bold text-amber-600">{todoResumo.concluidas_atraso}</p>
          </div>
        </div>

        {todos.length === 0 ? (
          <div className="text-sm text-slate-400 p-8 border border-dashed rounded-lg text-center bg-slate-50 dark:bg-slate-800/50">
            Nenhuma tarefa atribuída.
          </div>
        ) : (
          <div className="space-y-3">
            {todos.filter(t => t.status !== 'CONCLUIDO').slice(0, 5).map(todo => (
              <div key={todo.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {todo.status === 'CONCLUIDO' ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-slate-400" />}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate" title={todo.titulo}>{todo.titulo}</p>
                    <p className={`text-[11px] ${isOverdue(todo) ? 'text-red-600' : 'text-slate-400'}`}>
                      {todo.due_date ? `Prazo: ${todo.due_date.slice(0, 10)}` : 'Sem prazo'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {todo.status === 'PENDENTE' && (
                    <button onClick={() => iniciarTodo(todo.id)} className="px-3 py-2 rounded-lg text-xs font-bold border border-blue-300 text-blue-600 hover:bg-blue-50 transition flex items-center gap-1">
                      <Play size={14} /> Iniciar
                    </button>
                  )}
                  {todo.status === 'EM_ANDAMENTO' && (
                    <button onClick={() => finalizarTodo(todo.id)} className="px-3 py-2 rounded-lg text-xs font-bold border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition flex items-center gap-1">
                      <Check size={14} /> Finalizar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumo de Contas */}
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
          <Wallet className="w-5 h-5 text-slate-400" /> Suas Contas
        </h3>
        
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {contas.length === 0 ? (
            <div className="col-span-3 text-sm text-slate-400 p-8 border border-dashed rounded-lg text-center bg-slate-50 dark:bg-slate-800/50">
              Nenhuma conta cadastrada. <Link to="/contas" className="text-blue-500 hover:underline">Cadastrar agora</Link>
            </div>
          ) : (
            contas.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/40">
                
                {/* LADO ESQUERDO: ÍCONE E NOME */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 shrink-0 flex items-center justify-center overflow-hidden" style={{ color: primaryColor }}>
                    {c.logo_url ? (
                      <img src={getFullLogoUrl(c.logo_url) || ''} alt={c.nome} className="w-full h-full object-cover" />
                    ) : (
                      c.tipo === 'CAIXA' ? <Banknote size={20} /> : <Landmark size={20} />
                    )}
                  </div>
                  <div className="min-w-0"> {/* min-w-0 é essencial para o truncate funcionar dentro do flex */}
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-tight truncate" title={c.nome}>
                      {c.nome}
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase truncate">{c.tipo}</p>
                  </div>
                </div>

                {/* LADO DIREITO: VALOR (Não quebra linha) */}
                <p className="font-mono font-bold text-slate-800 dark:text-white whitespace-nowrap">
                  {BRL.format(getSaldo(c))}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Totalizador */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-sm font-bold text-slate-500 uppercase">Saldo Total Disponível</span>
          <span className="text-xl font-extrabold text-slate-800 dark:text-white">
            {BRL.format(saldoTotal)}
          </span>
        </div>
      </div>

      {/* Atalhos Rápidos */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <AtalhoCard to="/entidades" icon={Users} label="Clientes" description="Abrir cadastro e relacionamento com interessados." colorClass="text-green-600" bgClass="bg-green-100 dark:bg-green-500/10" />
        <AtalhoCard to="/contas" icon={Landmark} label="Contas" description="Gerenciar bancos, caixas e estrutura financeira." colorClass="text-purple-600" bgClass="bg-purple-100 dark:bg-purple-500/10" />
        <AtalhoCard to="/cartoes" icon={CreditCard} label="Cartões" description="Controlar faturas, limites e lançamentos vinculados." colorClass="text-orange-600" bgClass="bg-orange-100 dark:bg-orange-500/10" />
        <AtalhoCard to="/config" icon={Settings} label="Configuração" description="Ajustar preferências, empresa e comportamento do sistema." colorClass="text-slate-600" bgClass="bg-slate-100 dark:bg-slate-700/60" />
      </section>
    </div>
  );
}

// Pequena função para escurecer a cor e criar gradiente (simulada)
function adjustBrightness(col: string, amt: number) {
    // Se não for Hex válido, retorna a mesma cor
    if (!col || col[0] !== '#') return col;
    let usePound = false;
    if (col[0] == "#") {
        col = col.slice(1);
        usePound = true;
    }
    let num = parseInt(col,16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255; else if  (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255; else if  (b < 0) b = 0;
    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound?"#":"") + (g | (b << 8) | (r << 16)).toString(16);
}

function HeroMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">{label}</p>
      <p className={`mt-2 text-xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

function SummaryPanel({ title, value, support, tone }: { title: string; value: string; support: string; tone: 'emerald' | 'rose' | 'amber' | 'indigo' | 'cyan' | 'violet' }) {
  const toneMap = {
    emerald: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-500/10',
    rose: 'text-rose-500 bg-rose-100 dark:bg-rose-500/10',
    amber: 'text-amber-600 bg-amber-100 dark:bg-amber-500/10',
    indigo: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-500/10',
    cyan: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-500/10',
    violet: 'text-violet-600 bg-violet-100 dark:bg-violet-500/10',
  } as const;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className={`inline-flex rounded-2xl px-3 py-2 text-xs font-bold ${toneMap[tone]}`}>
        {title}
      </div>
      <p className="mt-4 text-3xl font-black text-slate-900 dark:text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{support}</p>
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
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">{description}</p>
      </div>
    </Link>
  );
}
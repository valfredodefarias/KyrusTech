import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { 
  PlusCircle, BarChart2, Users, Landmark, 
  CreditCard, Settings, Wallet, Banknote, Home as HomeIcon,
  ClipboardList, Circle, CheckCircle2, Play, Check
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

export function Home() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoResumo, setTodoResumo] = useState({
    amanha: 0,
    semana: 0,
    futuras: 0,
    atrasadas: 0,
    concluidas_atraso: 0
  });

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
        const resResumo = await api.get('/todos/resumo');
        setTodoResumo(resResumo.data);

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
  const nomeUsuario = user?.email.split('@')[0] || 'Consultor';
  
  // Definição da Cor Dinâmica (Se não tiver no banco, usa azul padrão)
  const primaryColor = empresa?.cor_primaria || '#2563eb'; 
  const bgStyle = {
    background: `linear-gradient(135deg, ${primaryColor} 0%, ${adjustBrightness(primaryColor, -20)} 100%)`
  };

  function getFullLogoUrl(url?: string | null) {
    if (!url) return null;
    if (url.startsWith('/static')) {
      const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
      return `${baseURL}${url}`;
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
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-10">
      
      {/* Header com Data */}
      <header className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-700 dark:text-white">
          <HomeIcon className="w-5 h-5" style={{ color: primaryColor }} /> Visão Geral
        </h2>
        <div className="text-sm text-slate-500 dark:text-slate-400 capitalize">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </header>

      {/* Cartão de Boas Vindas (Hero) PERSONALIZAVEL */}
      <div 
        className="rounded-2xl p-8 text-white shadow-xl relative overflow-hidden transition-colors duration-500"
        style={bgStyle} // APLICA A COR DO BANCO AQUI
      >
        <div className="absolute right-0 top-0 h-full w-1/3 bg-white/10 skew-x-12 pointer-events-none"></div>
        <div className="relative z-10">
          <h1 className="text-3xl font-extrabold mb-2 capitalize">Olá, {nomeUsuario}! 👋</h1>
          <p className="text-white/90 text-lg flex items-center gap-2">
            Você está gerenciando: 
            <strong className="bg-white/20 px-2 py-0.5 rounded backdrop-blur-sm">
              {empresa?.nome_fantasia || 'Sua Empresa'}
            </strong>
          </p>
          <div className="mt-6 flex gap-3 flex-wrap">
            <Link to="/lancamentos" className="bg-white text-slate-800 px-5 py-2.5 rounded-lg font-bold hover:bg-slate-50 transition shadow-sm flex items-center gap-2">
              <PlusCircle size={18} style={{ color: primaryColor }} /> Novo Lançamento
            </Link>
            <Link to="/dashboard" className="bg-black/20 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-black/30 transition flex items-center gap-2 border border-white/20">
              <BarChart2 size={18} /> Ver Relatórios
            </Link>
          </div>
        </div>
      </div>

      {/* Tarefas */}
      <div>
        <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-slate-400" /> Minhas Tarefas
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
            <p className="text-[11px] text-slate-500">Amanhã</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.amanha}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
            <p className="text-[11px] text-slate-500">Na semana</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.semana}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
            <p className="text-[11px] text-slate-500">Futuras</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.futuras}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
            <p className="text-[11px] text-slate-500">Atrasadas</p>
            <p className="text-xl font-bold text-red-600">{todoResumo.atrasadas}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
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
              <div key={todo.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between gap-4">
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
      <div>
        <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Wallet className="w-5 h-5 text-slate-400" /> Suas Contas
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {contas.length === 0 ? (
            <div className="col-span-3 text-sm text-slate-400 p-8 border border-dashed rounded-lg text-center bg-slate-50 dark:bg-slate-800/50">
              Nenhuma conta cadastrada. <Link to="/contas" className="text-blue-500 hover:underline">Cadastrar agora</Link>
            </div>
          ) : (
            contas.map(c => (
              <div key={c.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between hover:shadow-md transition gap-4">
                
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
        <div className="mt-4 p-4 bg-slate-100 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-200 dark:border-slate-700">
          <span className="text-sm font-bold text-slate-500 uppercase">Saldo Total Disponível</span>
          <span className="text-xl font-extrabold text-slate-800 dark:text-white">
            {BRL.format(saldoTotal)}
          </span>
        </div>
      </div>

      {/* Atalhos Rápidos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AtalhoCard to="/entidades" icon={Users} label="Clientes" colorClass="text-green-600" bgClass="bg-green-100" />
        <AtalhoCard to="/contas" icon={Landmark} label="Contas" colorClass="text-purple-600" bgClass="bg-purple-100" />
        <AtalhoCard to="/cartoes" icon={CreditCard} label="Cartões" colorClass="text-orange-600" bgClass="bg-orange-100" />
        <AtalhoCard to="/config" icon={Settings} label="Configuração" colorClass="text-slate-600" bgClass="bg-slate-100" />
      </div>
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

function AtalhoCard({ to, icon: Icon, label, colorClass, bgClass }: any) {
  return (
    <Link to={to} className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition group text-center block">
      <div className={`w-10 h-10 mx-auto ${bgClass} ${colorClass} dark:bg-opacity-20 rounded-full flex items-center justify-center mb-2 group-hover:scale-110 transition`}>
        <Icon size={20} />
      </div>
      <span className="font-bold text-slate-600 dark:text-slate-300 text-sm">{label}</span>
    </Link>
  );
}
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ClipboardList, Circle, CheckCircle2, Play, Check } from 'lucide-react';

interface TodoItem {
  id: number;
  titulo: string;
  descricao?: string | null;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | string;
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | string;
  due_date?: string | null;
  periodicidade?: 'UNICA' | 'DIARIA' | 'SEMANAL' | string;
  dias_semana?: string | null;
  inclui_sabado?: boolean;
}

interface TodoForm {
  titulo: string;
  descricao: string;
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA';
  due_date: string;
  end_date: string;
  periodicidade: 'UNICA' | 'DIARIA' | 'SEMANAL';
  dias_semana: string[];
  inclui_sabado: boolean;
  tipo_alvo: 'EMPRESA' | 'CONSULTOR';
}

export function Tarefas() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resumo, setResumo] = useState({
    amanha: 0,
    semana: 0,
    futuras: 0,
    atrasadas: 0,
    concluidas_atraso: 0
  });
  const [form, setForm] = useState<TodoForm>({
    titulo: '',
    descricao: '',
    prioridade: 'MEDIA',
    due_date: '',
    end_date: '',
    periodicidade: 'UNICA',
    dias_semana: [],
    inclui_sabado: false,
    tipo_alvo: 'EMPRESA'
  });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    try {
      setLoading(true);
      const res = await api.get<TodoItem[]>('/todos/me');
      setTodos(res.data);
      const r = await api.get('/todos/resumo');
      setResumo(r.data);
    } catch (error) {
      console.error('Erro ao carregar tarefas', error);
    } finally {
      setLoading(false);
    }
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

  async function iniciar(todoId: number) {
    await api.post(`/todos/${todoId}/iniciar`);
    carregar();
  }

  async function finalizar(todoId: number) {
    await api.post(`/todos/${todoId}/finalizar`);
    carregar();
  }

  const canCreate = (() => {
    if (!form.titulo.trim()) return false;
    if (!form.due_date) return false;
    if (form.periodicidade !== 'UNICA' && !form.end_date) return false;
    if (form.periodicidade === 'SEMANAL' && form.dias_semana.length === 0) return false;
    return true;
  })();

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      titulo: form.titulo,
      descricao: form.descricao || null,
      status: 'PENDENTE',
      prioridade: form.prioridade,
      due_date: form.due_date || null,
      end_date: form.periodicidade === 'UNICA' ? null : (form.end_date || null),
      periodicidade: form.periodicidade,
      dias_semana: form.dias_semana.length ? form.dias_semana.join(',') : null,
      inclui_sabado: form.inclui_sabado,
      tipo_alvo: form.tipo_alvo
    };
    await api.post('/todos/', payload);
    setForm({
      titulo: '',
      descricao: '',
      prioridade: 'MEDIA',
      due_date: '',
      end_date: '',
      periodicidade: 'UNICA',
      dias_semana: [],
      inclui_sabado: false,
      tipo_alvo: 'EMPRESA'
    });
    carregar();
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-10">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-slate-400" /> Tarefas
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
          <p className="text-[11px] text-slate-500">Amanhã</p>
          <p className="text-xl font-bold text-slate-800 dark:text-white">{resumo.amanha}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
          <p className="text-[11px] text-slate-500">Na semana</p>
          <p className="text-xl font-bold text-slate-800 dark:text-white">{resumo.semana}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
          <p className="text-[11px] text-slate-500">Futuras</p>
          <p className="text-xl font-bold text-slate-800 dark:text-white">{resumo.futuras}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
          <p className="text-[11px] text-slate-500">Atrasadas</p>
          <p className="text-xl font-bold text-red-600">{resumo.atrasadas}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
          <p className="text-[11px] text-slate-500">Concl. em atraso</p>
          <p className="text-xl font-bold text-amber-600">{resumo.concluidas_atraso}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(prev => !prev)}
          className="px-4 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2"
        >
          <ClipboardList className="w-4 h-4" /> {showForm ? 'Ocultar formulário' : 'Nova tarefa'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
          <h3 className="font-bold text-slate-800 dark:text-white mb-4">Criar Tarefa</h3>
          <form onSubmit={criar} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Título</label>
              <input
                required
                type="text"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                value={form.titulo}
                onChange={e => setForm({ ...form, titulo: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Descrição</label>
              <textarea
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                value={form.descricao}
                onChange={e => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Alvo</label>
              <select
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                value={form.tipo_alvo}
                onChange={e => setForm({ ...form, tipo_alvo: e.target.value as 'EMPRESA' | 'CONSULTOR' })}
              >
                <option value="EMPRESA">Empresa</option>
                <option value="CONSULTOR">Meu usuário</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Prioridade</label>
              <select
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                value={form.prioridade}
                onChange={e => setForm({ ...form, prioridade: e.target.value as TodoForm['prioridade'] })}
              >
                <option value="BAIXA">Baixa</option>
                <option value="MEDIA">Média</option>
                <option value="ALTA">Alta</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Periodicidade</label>
              <select
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                value={form.periodicidade}
                onChange={e => setForm({ ...form, periodicidade: e.target.value as TodoForm['periodicidade'] })}
              >
                <option value="UNICA">Única</option>
                <option value="DIARIA">Todo dia</option>
                <option value="SEMANAL">Semanal</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.inclui_sabado}
                onChange={e => setForm({ ...form, inclui_sabado: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <label className="text-sm text-slate-600 dark:text-slate-300">Inclui sábado?</label>
            </div>
            {form.periodicidade === 'SEMANAL' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold uppercase text-slate-500 mb-2 block">Dias da semana</label>
                <div className="flex flex-wrap gap-2">
                  {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(dia => (
                    <label key={dia} className={`px-3 py-1 rounded-full text-xs font-bold border cursor-pointer ${form.dias_semana.includes(dia) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={form.dias_semana.includes(dia)}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...form.dias_semana, dia]
                            : form.dias_semana.filter(d => d !== dia);
                          setForm({ ...form, dias_semana: next });
                        }}
                      />
                      {dia}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Prazo</label>
              <input
                type="date"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                value={form.due_date}
                onChange={e => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            {form.periodicidade !== 'UNICA' && (
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Data Fim</label>
                <input
                  type="date"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                  value={form.end_date}
                  onChange={e => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
            )}
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={!canCreate}
                className={`w-full py-3 font-bold rounded-xl transition ${canCreate ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-400 text-white cursor-not-allowed'}`}
              >
                Criar Tarefa
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Lista de Tarefas</h3>
        {loading ? (
          <div className="text-center text-slate-500">Carregando tarefas...</div>
        ) : todos.length === 0 ? (
          <div className="text-center text-slate-500">Nenhuma tarefa encontrada</div>
        ) : (
          <div className="space-y-6">
            {(["PENDENTE", "EM_ANDAMENTO", "CONCLUIDO"] as const).map(status => (
              <div key={status}>
                <p className="text-xs font-bold uppercase text-slate-500 mb-2">
                  {status === 'PENDENTE' && 'Pendentes'}
                  {status === 'EM_ANDAMENTO' && 'Em andamento'}
                  {status === 'CONCLUIDO' && 'Concluídas'}
                </p>
                <div className="space-y-3">
                  {todos.filter(t => t.status === status).length === 0 ? (
                    <div className="text-xs text-slate-400">Nenhuma tarefa</div>
                  ) : (
                    todos.filter(t => t.status === status).map(todo => (
                      <div key={todo.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {todo.status === 'CONCLUIDO' ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-slate-400" />}
                            <p className="font-bold text-slate-800 dark:text-white">{todo.titulo}</p>
                            {isOverdue(todo) && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">ATRASADA</span>}
                          </div>
                          {todo.descricao && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{todo.descricao}</p>}
                          <p className="text-[11px] text-slate-400 mt-1">
                            {todo.due_date ? `Prazo: ${todo.due_date.slice(0, 10)}` : 'Sem prazo'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {todo.periodicidade === 'DIARIA' && 'Periodicidade: todo dia'}
                            {todo.periodicidade === 'SEMANAL' && `Periodicidade: semanal (${todo.dias_semana || '-'})`}
                            {(!todo.periodicidade || todo.periodicidade === 'UNICA') && 'Periodicidade: única'}
                            {todo.inclui_sabado ? ' • Inclui sábado' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {todo.status === 'PENDENTE' && (
                            <button
                              onClick={() => iniciar(todo.id)}
                              className="px-3 py-2 rounded-lg text-xs font-bold border border-blue-300 text-blue-600 hover:bg-blue-50 transition flex items-center gap-1"
                            >
                              <Play size={14} /> Iniciar
                            </button>
                          )}
                          {todo.status === 'EM_ANDAMENTO' && (
                            <button
                              onClick={() => finalizar(todo.id)}
                              className="px-3 py-2 rounded-lg text-xs font-bold border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition flex items-center gap-1"
                            >
                              <Check size={14} /> Finalizar
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

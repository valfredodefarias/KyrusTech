import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Bot, Loader2, Send, Sparkles, User2, X } from 'lucide-react';

import { api } from '../services/api';

type TelaAssistente = 'dashboard' | 'lancamentos' | 'geral';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type PlanoLancamentoItem = {
  descricao: string;
  tipo: 'RECEITA' | 'DESPESA';
  valor_previsto: number | string;
  data_vencimento: string;
  plano_contas_id: number;
  previsto?: boolean;
  conta_id?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
  cartao_id?: number | null;
  competencia?: string | null;
  observacao?: string | null;
  data_pagamento?: string | null;
};

type AiAssistenteProps = {
  tela: TelaAssistente;
  contexto: Record<string, unknown>;
  titulo?: string;
  sugestoes?: string[];
};

type ApiResponse = {
  resposta: string;
  modelo: string;
  tipo_resposta?: 'TEXTO' | 'PLANO_LANCAMENTOS' | 'EXECUCAO_LANCAMENTOS';
  plano_lancamentos?: PlanoLancamentoItem[];
  plano_assinatura?: string;
  itens_criados?: number;
};

const DEFAULT_SUGESTOES: string[] = [
  'Me explique os principais pontos da tela atual.',
  'Qual o risco financeiro mais importante agora?',
  'Que acoes praticas voce recomenda para hoje?',
];

export function AiAssistente({
  tela,
  contexto,
  titulo = 'Assistente IA',
  sugestoes = DEFAULT_SUGESTOES,
}: AiAssistenteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Posso te ajudar a interpretar seus numeros e sugerir proximas acoes.',
    },
  ]);
  const [planoPendente, setPlanoPendente] = useState<{
    itens: PlanoLancamentoItem[];
    assinatura: string;
  } | null>(null);

  const canSend = useMemo(() => input.trim().length >= 3 && !loading, [input, loading]);

  const perguntar = async (pergunta: string) => {
    const clean = pergunta.trim();
    if (clean.length < 3 || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: clean }]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post<ApiResponse>('/ai/assistente', {
        pergunta: clean,
        tela,
        contexto,
      });

      if (data.tipo_resposta === 'PLANO_LANCAMENTOS' && data.plano_lancamentos?.length && data.plano_assinatura) {
        setPlanoPendente({ itens: data.plano_lancamentos, assinatura: data.plano_assinatura });
      }

      if (data.tipo_resposta === 'EXECUCAO_LANCAMENTOS') {
        setPlanoPendente(null);
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.resposta }]);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const msg = typeof detail === 'string' && detail.trim().length > 0
        ? detail
        : 'Nao consegui responder agora. Tente novamente em instantes.';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await perguntar(input);
  };

  const confirmarPlanoLancamentos = async () => {
    if (!planoPendente || loading) return;

    setLoading(true);
    try {
      const { data } = await api.post<ApiResponse>('/ai/assistente', {
        pergunta: 'Confirmar execucao do plano de lancamentos',
        tela,
        contexto,
        acao: 'CONFIRMAR_PLANO_LANCAMENTOS',
        plano_lancamentos: planoPendente.itens,
        plano_assinatura: planoPendente.assinatura,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.resposta }]);
      setPlanoPendente(null);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const msg = typeof detail === 'string' && detail.trim().length > 0
        ? detail
        : 'Nao consegui confirmar esse plano agora.';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  const cancelarPlanoLancamentos = () => {
    setPlanoPendente(null);
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Plano descartado. Posso montar outro quando quiser.' }]);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-cyan-600 px-4 py-3 text-sm font-bold text-white shadow-xl transition hover:bg-cyan-500"
      >
        <Sparkles className="h-4 w-4" />
        Assistente
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-5 z-50 w-[92vw] max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-600" />
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{titulo}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Tela: {tela}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              aria-label="Fechar assistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={`rounded-xl border px-3 py-2 text-sm ${msg.role === 'assistant'
                  ? 'border-cyan-100 bg-cyan-50 text-slate-700 dark:border-cyan-900/40 dark:bg-cyan-900/20 dark:text-slate-200'
                  : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {msg.role === 'assistant' ? <Bot className="h-3 w-3" /> : <User2 className="h-3 w-3" />}
                  {msg.role === 'assistant' ? 'Assistente' : 'Voce'}
                </div>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ))}
            {loading && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Pensando...
              </div>
            )}

            {planoPendente && tela === 'lancamentos' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-900/20">
                <p className="mb-2 font-bold text-amber-700 dark:text-amber-300">Previa de lancamentos ({planoPendente.itens.length})</p>
                <div className="max-h-40 overflow-y-auto rounded border border-amber-200 bg-white dark:border-amber-800 dark:bg-slate-900">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="px-2 py-1 text-left">Descricao</th>
                        <th className="px-2 py-1 text-left">Venc.</th>
                        <th className="px-2 py-1 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planoPendente.itens.slice(0, 12).map((item, idx) => (
                        <tr key={`${item.descricao}-${item.data_vencimento}-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-2 py-1 text-slate-700 dark:text-slate-200">{item.descricao}</td>
                          <td className="px-2 py-1 text-slate-500">{item.data_vencimento}</td>
                          <td className="px-2 py-1 text-right font-bold text-slate-700 dark:text-slate-200">{Number(item.valor_previsto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {planoPendente.itens.length > 12 && (
                  <p className="mt-1 text-[10px] text-slate-500">Mostrando 12 de {planoPendente.itens.length} itens.</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmarPlanoLancamentos}
                    disabled={loading}
                    className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Confirmar e criar
                  </button>
                  <button
                    type="button"
                    onClick={cancelarPlanoLancamentos}
                    disabled={loading}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sugestoes.slice(0, 3).map((sugestao) => (
                <button
                  key={sugestao}
                  type="button"
                  onClick={() => perguntar(sugestao)}
                  disabled={loading}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {sugestao}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Digite sua duvida..."
                className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600 text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Enviar pergunta"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

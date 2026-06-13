import { useEffect, useMemo, useState } from 'react';
import type { SVGProps } from 'react';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { api } from '../services/api';

type AiConsultantPanelProps = {
  ano: number;
  mes: number;
  empresaId?: number | null;
  className?: string;
};

type AnaliseFechamentoResponse = {
  markdown?: string;
  resposta?: string;
  content?: string;
  dossie?: string;
};

const ROTATING_MESSAGES = [
  'Iniciando análise de dados...',
  'Controller avaliando margens e ineficiências...',
  'Redigindo dossiê executivo...',
  'Consolidando anomalias e impactos de caixa...',
];

const requestTimeoutMs = 15 * 60 * 1000;

const toMarkdownText = (data: unknown) => {
  if (typeof data === 'string') {
    return data.trim();
  }

  if (data && typeof data === 'object') {
    const payload = data as AnaliseFechamentoResponse;
    return String(payload.markdown ?? payload.resposta ?? payload.content ?? payload.dossie ?? '').trim();
  }

  return '';
};

const SwitchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M8 5h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10Z" />
    <circle cx="8" cy="10" r="3" />
  </svg>
);

export function AiConsultantPanel({ ano, mes, empresaId, className = '' }: AiConsultantPanelProps) {
  const [considerarPo, setConsiderarPo] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusIndex, setStatusIndex] = useState(0);

  const statusMessage = useMemo(() => ROTATING_MESSAGES[statusIndex % ROTATING_MESSAGES.length], [statusIndex]);

  useEffect(() => {
    setMarkdown('');
    setError(null);
  }, [ano, mes, empresaId]);

  useEffect(() => {
    if (!isGenerating) {
      setStatusIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % ROTATING_MESSAGES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const gerarDossie = async () => {
    if (!empresaId || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setMarkdown('');

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const { data } = await api.post(
        '/ai/analise-fechamento',
        {
          ano,
          mes,
          considerar_po: considerarPo,
        },
        {
          signal: controller.signal,
          timeout: requestTimeoutMs,
        },
      );

      const markdownText = toMarkdownText(data);
      if (!markdownText) {
        throw new Error('A resposta do dossiê veio vazia.');
      }

      setMarkdown(markdownText);
    } catch (exception: any) {
      if (exception?.name === 'CanceledError' || exception?.name === 'AbortError') {
        setError('A geração levou tempo demais e foi interrompida. Tente novamente.');
      } else {
        const detail = exception?.response?.data?.detail;
        setError(typeof detail === 'string' && detail.trim() ? detail : 'Não foi possível gerar o dossiê agora.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  };

  return (
    <section className={`rounded-3xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none ${className}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Consultor IA</p>
            <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-slate-50">Gerar Dossiê de Fechamento</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Orquestra uma análise multi-agente para o período selecionado e devolve um dossiê executivo em Markdown com diagnóstico, anomalias e plano de ação.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setConsiderarPo((current) => !current)}
            aria-pressed={considerarPo}
            className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-slate-600 dark:hover:bg-slate-800/60"
          >
            <span className={`mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition ${considerarPo ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
              <SwitchIcon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black text-slate-800 dark:text-slate-100">Levar em consideração o Planejamento Orçamentário (PO)</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                {considerarPo ? 'Ativo: a análise cruza realizado, orçamento e mês anterior.' : 'Inativo: a análise usa somente realizado e comparação com o mês anterior.'}
              </span>
            </span>
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:items-end">
          <button
            type="button"
            onClick={gerarDossie}
            disabled={isGenerating || !empresaId}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? 'Gerando...' : 'Gerar Dossiê de Fechamento (IA)'}
          </button>
          <div className="text-right text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            Período: {String(mes).padStart(2, '0')}/{ano}
            {!empresaId ? <span className="block text-rose-500 dark:text-rose-300">Selecione uma empresa para continuar.</span> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1.25fr]">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Estado da análise
          </div>

          {isGenerating ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{statusMessage}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">A arquitetura multi-agente ainda está trabalhando. Isso pode levar alguns minutos.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-dashed border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/80">
                <div className="h-3 w-3/5 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-4/5 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                  <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                  <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          ) : markdown ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/10 dark:text-emerald-100">
              Dossiê gerado com sucesso. O texto completo está disponível ao lado.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300">
              Nenhuma análise foi gerada ainda. Clique no botão acima para iniciar o fluxo executivo.
            </div>
          )}

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="min-h-[18rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Relatório</p>
              <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">Dossiê Executivo em Markdown</h4>
            </div>
          </div>

          <div className="prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 prose-h1:mb-4 prose-h1:text-2xl prose-h1:font-black prose-h2:mb-3 prose-h2:mt-6 prose-h2:text-xl prose-h2:font-black prose-h3:mb-2 prose-h3:mt-5 prose-h3:text-lg prose-h3:font-bold prose-p:leading-7 prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-strong:text-slate-900 dark:prose-strong:text-slate-100 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:pl-4 prose-blockquote:italic">
            {markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdown}
              </ReactMarkdown>
            ) : (
              <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
                <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-11/12 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-5/6 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-3/5 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                <p className="pt-3">O dossiê final aparecerá aqui em formato oficial, com títulos hierárquicos e leitura contínua.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

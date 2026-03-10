import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Bot, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Maximize2, Minimize2, Paperclip, PencilLine, Send, Sparkles, Trash2, User2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { api } from '../services/api';

export type TelaAssistente = 'dashboard' | 'lancamentos' | 'geral';

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
  sugestao_acao?: 'CRIAR_NOVO' | 'BAIXAR_PREVISTO' | 'RELACIONAR_ATRASADO' | 'IGNORAR_DUPLICATA';
  motivo_conciliacao?: string | null;
  lancamento_relacionado_id?: number | null;
  duplicata_id?: number | null;
  relacionado_resumo?: string | null;
};

type LookupItem = { id: number; nome: string; tipo?: string };

export type AssistenteLookups = {
  categorias?: LookupItem[];
  contas?: LookupItem[];
  centros?: LookupItem[];
  entidades?: LookupItem[];
  cartoes?: LookupItem[];
};

type AttachmentPayload = {
  nome: string;
  mime_type: string;
  tipo: 'TEXTO' | 'PLANILHA' | 'IMAGEM' | 'PDF';
  conteudo_texto?: string;
  base64_data?: string;
};

type AttachmentDraft = {
  id: string;
  label: string;
  payload: AttachmentPayload;
};

export type AiAssistenteProps = {
  tela: TelaAssistente;
  contexto: Record<string, unknown>;
  titulo?: string;
  sugestoes?: string[];
  lookups?: AssistenteLookups;
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
  'Leia este comprovante e monte uma previa revisavel.',
];

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const sanitizeText = (value: string, max = 16000) => value.replace(/\u0000/g, ' ').trim().slice(0, max);

const fileToBase64 = async (file: File) => {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const inferMimeType = (file: File) => {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return 'text/csv';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
};

const extractSpreadsheetText = async (file: File) => {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv' || file.type === 'text/csv') {
    return sanitizeText(await file.text());
  }

  if (ext === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const lines: string[] = [];
    workbook.worksheets.slice(0, 3).forEach((sheet) => {
      lines.push(`Planilha: ${sheet.name}`);
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber > 80) return;
        const values = row.values instanceof Array ? row.values.slice(1) : [];
        const serialized = values.map((value) => String(value ?? '').trim()).filter(Boolean).join(' | ');
        if (serialized) {
          lines.push(serialized);
        }
      });
      lines.push('');
    });
    return sanitizeText(lines.join('\n'));
  }

  throw new Error('Formato de planilha ainda nao suportado. Use CSV ou XLSX.');
};

const buildAttachmentDraft = async (file: File): Promise<AttachmentDraft> => {
  const mimeType = inferMimeType(file);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const id = `${file.name}-${file.size}-${file.lastModified}`;

  if (mimeType.startsWith('image/')) {
    return {
      id,
      label: `${file.name} · comprovante`,
      payload: {
        nome: file.name,
        mime_type: mimeType,
        tipo: 'IMAGEM',
        base64_data: await fileToBase64(file),
      },
    };
  }

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return {
      id,
      label: `${file.name} · PDF`,
      payload: {
        nome: file.name,
        mime_type: 'application/pdf',
        tipo: 'PDF',
        base64_data: await fileToBase64(file),
      },
    };
  }

  if (mimeType === 'text/plain' || ext === 'txt') {
    return {
      id,
      label: `${file.name} · texto`,
      payload: {
        nome: file.name,
        mime_type: mimeType,
        tipo: 'TEXTO',
        conteudo_texto: sanitizeText(await file.text()),
      },
    };
  }

  if (mimeType === 'text/csv' || ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
    return {
      id,
      label: `${file.name} · planilha`,
      payload: {
        nome: file.name,
        mime_type: mimeType,
        tipo: 'PLANILHA',
        conteudo_texto: await extractSpreadsheetText(file),
      },
    };
  }

  throw new Error('Tipo de arquivo nao suportado. Use imagem, PDF, TXT, CSV ou XLSX.');
};

const normalizePlano = (itens: PlanoLancamentoItem[]) => itens.map((item) => ({
  ...item,
  valor_previsto: Number(item.valor_previsto || 0),
  conta_id: item.conta_id ?? null,
  entidade_id: item.entidade_id ?? null,
  centro_custo_id: item.centro_custo_id ?? null,
  cartao_id: item.cartao_id ?? null,
  observacao: item.observacao ?? '',
  competencia: item.competencia ?? '',
  data_pagamento: item.data_pagamento ?? '',
  sugestao_acao: item.sugestao_acao ?? 'CRIAR_NOVO',
  motivo_conciliacao: item.motivo_conciliacao ?? '',
  lancamento_relacionado_id: item.lancamento_relacionado_id ?? null,
  duplicata_id: item.duplicata_id ?? null,
  relacionado_resumo: item.relacionado_resumo ?? '',
}));

const getPlanoActionMeta = (action?: PlanoLancamentoItem['sugestao_acao']) => {
  if (action === 'BAIXAR_PREVISTO') {
    return {
      label: 'Baixar previsto',
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      rowClassName: 'bg-emerald-50/50 dark:bg-emerald-900/10',
    };
  }
  if (action === 'RELACIONAR_ATRASADO') {
    return {
      label: 'Vincular atraso',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      rowClassName: 'bg-amber-50/50 dark:bg-amber-900/10',
    };
  }
  if (action === 'IGNORAR_DUPLICATA') {
    return {
      label: 'Duplicado',
      className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      rowClassName: 'bg-rose-50/50 dark:bg-rose-900/10',
    };
  }
  return {
    label: 'Criar novo',
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    rowClassName: '',
  };
};

export function AiAssistente({
  tela,
  contexto,
  titulo = 'Assistente KyrusTECH',
  sugestoes = DEFAULT_SUGESTOES,
  lookups,
}: AiAssistenteProps) {
  const initialMessage = useMemo(() => {
    if (tela === 'dashboard') {
      return 'Posso analisar este dashboard como seu consultor financeiro e empresarial, explicar os indicadores em profundidade e sugerir prioridades de melhoria.';
    }
    if (tela === 'lancamentos') {
      return 'Posso analisar a tela atual, ler planilhas e comprovantes, sugerir classificacao e montar uma previa revisavel antes de qualquer criacao.';
    }
    return 'Posso explicar a pagina atual, apontar riscos e oportunidades e montar uma previa revisavel quando houver pedido operacional.';
  }, [tela]);
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(tela === 'lancamentos');
  const [loading, setLoading] = useState(false);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: initialMessage,
    },
  ]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [planoPendente, setPlanoPendente] = useState<{
    itens: PlanoLancamentoItem[];
    assinatura: string;
    editando: boolean;
    sujo: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => (input.trim().length >= 3 || attachments.length > 0) && !loading && !attachmentLoading, [attachments.length, input, loading, attachmentLoading]);
  const planoResumo = useMemo(() => {
    if (!planoPendente) return null;
    return planoPendente.itens.reduce((acc, item) => {
      const action = item.sugestao_acao || 'CRIAR_NOVO';
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, { CRIAR_NOVO: 0, BAIXAR_PREVISTO: 0, RELACIONAR_ATRASADO: 0, IGNORAR_DUPLICATA: 0 } as Record<'CRIAR_NOVO' | 'BAIXAR_PREVISTO' | 'RELACIONAR_ATRASADO' | 'IGNORAR_DUPLICATA', number>);
  }, [planoPendente]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, planoPendente, loading]);

  useEffect(() => {
    setMessages([{ role: 'assistant', content: initialMessage }]);
    setAttachments([]);
    setPlanoPendente(null);
    setInput('');
    setLoading(false);
    setAttachmentLoading(false);
    setIsExpanded(tela === 'lancamentos');
  }, [initialMessage, tela]);

  const addAssistantMessage = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  };

  const perguntar = async (pergunta: string) => {
    const clean = pergunta.trim();
    if ((clean.length < 3 && attachments.length === 0) || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: clean || 'Analise estes anexos e monte uma previa revisavel.' }]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post<ApiResponse>('/ai/assistente', {
        pergunta: clean || 'Analise estes anexos e monte uma previa revisavel.',
        tela,
        contexto,
        anexos: attachments.map((attachment) => attachment.payload),
      });

      if (data.tipo_resposta === 'PLANO_LANCAMENTOS' && data.plano_lancamentos?.length && data.plano_assinatura) {
        setPlanoPendente({ itens: normalizePlano(data.plano_lancamentos), assinatura: data.plano_assinatura, editando: false, sujo: false });
      }

      if (data.tipo_resposta === 'EXECUCAO_LANCAMENTOS') {
        setPlanoPendente(null);
        setAttachments([]);
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.resposta }]);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const msg = typeof detail === 'string' && detail.trim().length > 0
        ? detail
        : 'Nao consegui responder agora. Tente novamente em instantes.';
      addAssistantMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await perguntar(input);
  };

  const revisarPlanoLancamentos = async () => {
    if (!planoPendente || loading) return;

    setLoading(true);
    try {
      const { data } = await api.post<ApiResponse>('/ai/assistente', {
        pergunta: 'Revisar plano editado de lancamentos',
        tela,
        contexto,
        acao: 'REVISAR_PLANO_LANCAMENTOS',
        plano_lancamentos: planoPendente.itens,
      });

      if (data.plano_lancamentos?.length && data.plano_assinatura) {
        setPlanoPendente({ itens: normalizePlano(data.plano_lancamentos), assinatura: data.plano_assinatura, editando: false, sujo: false });
      }
      addAssistantMessage(data.resposta);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      addAssistantMessage(typeof detail === 'string' && detail.trim() ? detail : 'Nao consegui revisar esse plano agora.');
    } finally {
      setLoading(false);
    }
  };

  const confirmarPlanoLancamentos = async () => {
    if (!planoPendente || loading) return;
    if (planoPendente.sujo) {
      addAssistantMessage('Existe uma edicao pendente na previa. Clique em revisar antes de confirmar a criacao.');
      return;
    }

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
      setAttachments([]);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const msg = typeof detail === 'string' && detail.trim().length > 0
        ? detail
        : 'Nao consegui confirmar esse plano agora.';
      addAssistantMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const cancelarPlanoLancamentos = () => {
    setPlanoPendente(null);
    addAssistantMessage('Plano descartado. Posso montar outro quando quiser.');
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    if (attachments.length + files.length > 4) {
      addAssistantMessage('Use no maximo 4 anexos por vez para manter a revisao segura e legivel.');
      event.target.value = '';
      return;
    }

    setAttachmentLoading(true);
    try {
      const drafts = await Promise.all(files.map((file) => buildAttachmentDraft(file)));
      setAttachments((prev) => [...prev, ...drafts]);
      addAssistantMessage('Anexos preparados. Posso ler comprovantes, PDFs e planilhas e montar uma previa revisavel.');
    } catch (error: any) {
      addAssistantMessage(error?.message || 'Nao consegui ler um dos arquivos enviados.');
    } finally {
      setAttachmentLoading(false);
      event.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  };

  const updatePlanoItem = (index: number, key: keyof PlanoLancamentoItem, value: string | number | boolean | null) => {
    setPlanoPendente((prev) => {
      if (!prev) return prev;
      const itens = [...prev.itens];
      itens[index] = { ...itens[index], [key]: value };
      return { ...prev, itens, sujo: true };
    });
  };

  const renderLookupOptions = (items?: LookupItem[]) => (items || []).map((item) => (
    <option key={item.id} value={item.id}>{item.nome}</option>
  ));

  const modalClassName = isExpanded
    ? 'fixed inset-4 md:inset-6 z-50 flex flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900'
    : 'fixed bottom-20 right-5 z-50 flex h-[min(82vh,760px)] w-[min(94vw,960px)] max-w-4xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900';

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
        <div className={modalClassName}>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-cyan-50 p-2 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{titulo}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Tela: {tela} · conversa e previa revisavel</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setIsExpanded((prev) => !prev)} className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Alternar tamanho do assistente">
                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Fechar assistente"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={`rounded-2xl border px-4 py-3 text-sm ${msg.role === 'assistant'
                  ? 'border-cyan-100 bg-cyan-50 text-slate-700 dark:border-cyan-900/40 dark:bg-cyan-900/20 dark:text-slate-200'
                  : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {msg.role === 'assistant' ? <Bot className="h-3 w-3" /> : <User2 className="h-3 w-3" />}
                  {msg.role === 'assistant' ? 'Assistente' : 'Voce'}
                </div>
                <div className="ai-markdown max-w-none text-sm leading-6 text-inherit">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="mb-2 mt-1 text-lg font-black text-inherit">{children}</h1>,
                      h2: ({ children }) => <h2 className="mb-2 mt-1 text-base font-black text-inherit">{children}</h2>,
                      h3: ({ children }) => <h3 className="mb-1 mt-1 text-sm font-bold text-inherit">{children}</h3>,
                      p: ({ children }) => <p className="mb-2 whitespace-pre-wrap last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
                      li: ({ children }) => <li className="pl-0.5">{children}</li>,
                      strong: ({ children }) => <strong className="font-black text-inherit">{children}</strong>,
                      em: ({ children }) => <em className="italic text-inherit">{children}</em>,
                      code: ({ children }) => <code className="rounded bg-slate-900/10 px-1.5 py-0.5 text-[0.92em] dark:bg-slate-100/10">{children}</code>,
                      pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-slate-100">{children}</pre>,
                      blockquote: ({ children }) => <blockquote className="mb-2 border-l-4 border-cyan-500/50 pl-3 italic opacity-90">{children}</blockquote>,
                      table: ({ children }) => <div className="mb-2 overflow-x-auto"><table className="min-w-full border-collapse text-xs">{children}</table></div>,
                      thead: ({ children }) => <thead className="bg-slate-900/10 dark:bg-slate-100/10">{children}</thead>,
                      th: ({ children }) => <th className="border border-slate-300 px-2 py-1 text-left font-bold dark:border-slate-700">{children}</th>,
                      td: ({ children }) => <td className="border border-slate-300 px-2 py-1 align-top dark:border-slate-700">{children}</td>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}

            {planoPendente && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs dark:border-amber-800 dark:bg-amber-900/20">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-amber-700 dark:text-amber-300">Previa de lancamentos ({planoPendente.itens.length})</p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-200/80">Os itens abaixo ainda nao foram criados diretamente. Na confirmacao, o sistema ignora duplicatas e pode baixar previsto ou vincular atraso quando houver compatibilidade.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPlanoPendente((prev) => prev ? { ...prev, editando: !prev.editando } : prev)} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-[11px] font-bold text-amber-700 transition hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200">
                      <PencilLine className="mr-1 inline h-3.5 w-3.5" />
                      {planoPendente.editando ? 'Fechar edicao' : 'Editar itens'}
                    </button>
                    {planoPendente.sujo && (
                      <button type="button" onClick={revisarPlanoLancamentos} disabled={loading} className="rounded-xl bg-cyan-600 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50">
                        Revisar alteracoes
                      </button>
                    )}
                  </div>
                </div>

                {planoResumo && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {([
                      ['CRIAR_NOVO', 'Criar novo'],
                      ['BAIXAR_PREVISTO', 'Baixar previsto'],
                      ['RELACIONAR_ATRASADO', 'Vincular atraso'],
                      ['IGNORAR_DUPLICATA', 'Duplicado'],
                    ] as const).map(([key, label]) => planoResumo[key] > 0 ? (
                      <span key={key} className={`rounded-full px-3 py-1 text-[11px] font-bold ${getPlanoActionMeta(key).className}`}>
                        {planoResumo[key]} {label.toLowerCase()}
                      </span>
                    ) : null)}
                  </div>
                )}

                <div className="max-h-80 overflow-y-auto rounded-2xl border border-amber-200 bg-white dark:border-amber-800 dark:bg-slate-950">
                  <table className="w-full min-w-260 text-[11px]">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        <th className="px-2 py-2 text-left">Ação</th>
                        <th className="px-2 py-2 text-left">Descricao</th>
                        <th className="px-2 py-2 text-left">Tipo</th>
                        <th className="px-2 py-2 text-right">Valor</th>
                        <th className="px-2 py-2 text-left">Venc.</th>
                        <th className="px-2 py-2 text-left">Categoria</th>
                        <th className="px-2 py-2 text-left">Conta</th>
                        <th className="px-2 py-2 text-left">Centro</th>
                        <th className="px-2 py-2 text-left">Interessado</th>
                        <th className="px-2 py-2 text-left">Diagnóstico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planoPendente.itens.map((item, idx) => {
                        const actionMeta = getPlanoActionMeta(item.sugestao_acao);
                        return (
                        <tr key={`${item.descricao}-${item.data_vencimento}-${idx}`} className={`border-t border-slate-100 dark:border-slate-800 ${actionMeta.rowClassName}`}>
                          <td className="px-2 py-2 align-top">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${actionMeta.className}`}>{actionMeta.label}</span>
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando ? (
                              <input value={item.descricao} onChange={(event) => updatePlanoItem(idx, 'descricao', event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900" />
                            ) : item.descricao}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando ? (
                              <select value={item.tipo} onChange={(event) => updatePlanoItem(idx, 'tipo', event.target.value as PlanoLancamentoItem['tipo'])} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="RECEITA">Receita</option>
                                <option value="DESPESA">Despesa</option>
                              </select>
                            ) : item.tipo}
                          </td>
                          <td className="px-2 py-2 text-right font-bold align-top">
                            {planoPendente.editando ? (
                              <input type="number" step="0.01" value={item.valor_previsto} onChange={(event) => updatePlanoItem(idx, 'valor_previsto', Number(event.target.value || 0))} className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right text-[11px] dark:border-slate-700 dark:bg-slate-900" />
                            ) : BRL.format(Number(item.valor_previsto || 0))}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando ? (
                              <input type="date" value={item.data_vencimento} onChange={(event) => updatePlanoItem(idx, 'data_vencimento', event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900" />
                            ) : item.data_vencimento}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando && lookups?.categorias?.length ? (
                              <select value={item.plano_contas_id} onChange={(event) => updatePlanoItem(idx, 'plano_contas_id', Number(event.target.value))} className="max-w-44 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                {renderLookupOptions(lookups?.categorias)}
                              </select>
                            ) : (lookups?.categorias?.find((entry) => entry.id === item.plano_contas_id)?.nome || 'Categoria definida')}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando && lookups?.contas?.length ? (
                              <select value={item.conta_id ?? ''} onChange={(event) => updatePlanoItem(idx, 'conta_id', event.target.value ? Number(event.target.value) : null)} className="max-w-40 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="">-</option>
                                {renderLookupOptions(lookups?.contas)}
                              </select>
                            ) : (lookups?.contas?.find((entry) => entry.id === item.conta_id)?.nome || 'Nao informado')}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando && lookups?.centros?.length ? (
                              <select value={item.centro_custo_id ?? ''} onChange={(event) => updatePlanoItem(idx, 'centro_custo_id', event.target.value ? Number(event.target.value) : null)} className="max-w-40 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="">-</option>
                                {renderLookupOptions(lookups?.centros)}
                              </select>
                            ) : (lookups?.centros?.find((entry) => entry.id === item.centro_custo_id)?.nome || 'Nao informado')}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando && lookups?.entidades?.length ? (
                              <select value={item.entidade_id ?? ''} onChange={(event) => updatePlanoItem(idx, 'entidade_id', event.target.value ? Number(event.target.value) : null)} className="max-w-44 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="">-</option>
                                {renderLookupOptions(lookups?.entidades)}
                              </select>
                            ) : (lookups?.entidades?.find((entry) => entry.id === item.entidade_id)?.nome || 'Nao informado')}
                          </td>
                          <td className="px-2 py-2 align-top text-slate-500 dark:text-slate-300">
                            <div className="min-w-56 space-y-1">
                              <p>{item.motivo_conciliacao || 'Sem diagnóstico adicional.'}</p>
                              {item.relacionado_resumo && <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{item.relacionado_resumo}</p>}
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmarPlanoLancamentos}
                    disabled={loading || planoPendente.sujo}
                    className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Confirmar execução inteligente
                  </button>
                  <button
                    type="button"
                    onClick={cancelarPlanoLancamentos}
                    disabled={loading}
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {(loading || attachmentLoading) && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                {attachmentLoading ? 'Lendo anexos...' : 'Pensando...'}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {sugestoes.slice(0, 4).map((sugestao) => (
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

            {attachments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[11px] font-semibold text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-300">
                    {attachment.payload.tipo === 'PLANILHA' ? <FileSpreadsheet className="h-3.5 w-3.5" /> : attachment.payload.tipo === 'IMAGEM' ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    <span>{attachment.label}</span>
                    <button type="button" onClick={() => removeAttachment(attachment.id)} className="opacity-70 transition hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={onSubmit} className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Digite sua duvida ou peça para ler um comprovante/planilha..."
                  rows={isExpanded ? 4 : 3}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.xlsx,.txt" multiple className="hidden" onChange={handleFilesSelected} />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-300 px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <Paperclip className="h-4 w-4" />
                  Anexar
                </button>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

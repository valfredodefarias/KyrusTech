import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import ExcelJS from 'exceljs';
import { Bot, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Maximize2, Minimize2, Paperclip, PencilLine, Send, Sparkles, Trash2, User2, X } from 'lucide-react';

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

type LookupItem = { id: number; nome: string; tipo?: string };

type AssistenteLookups = {
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

type AiAssistenteProps = {
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
}));

export function AiAssistente({
  tela,
  contexto,
  titulo = 'Assistente IA',
  sugestoes = DEFAULT_SUGESTOES,
  lookups,
}: AiAssistenteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(tela === 'lancamentos');
  const [loading, setLoading] = useState(false);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Posso analisar a tela atual, ler planilhas e comprovantes, sugerir classificacao e montar uma previa revisavel antes de qualquer criacao.',
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

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, planoPendente, loading]);

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
                <p className="whitespace-pre-wrap leading-6">{msg.content}</p>
              </div>
            ))}

            {planoPendente && tela === 'lancamentos' && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs dark:border-amber-800 dark:bg-amber-900/20">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-amber-700 dark:text-amber-300">Previa de lancamentos ({planoPendente.itens.length})</p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-200/80">Os itens abaixo ainda nao foram criados. Revise, edite se precisar e confirme quando estiver seguro.</p>
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

                <div className="max-h-80 overflow-y-auto rounded-2xl border border-amber-200 bg-white dark:border-amber-800 dark:bg-slate-950">
                  <table className="w-full min-w-225 text-[11px]">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        <th className="px-2 py-2 text-left">Descricao</th>
                        <th className="px-2 py-2 text-left">Tipo</th>
                        <th className="px-2 py-2 text-right">Valor</th>
                        <th className="px-2 py-2 text-left">Venc.</th>
                        <th className="px-2 py-2 text-left">Categoria</th>
                        <th className="px-2 py-2 text-left">Conta</th>
                        <th className="px-2 py-2 text-left">Centro</th>
                        <th className="px-2 py-2 text-left">Entidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planoPendente.itens.map((item, idx) => (
                        <tr key={`${item.descricao}-${item.data_vencimento}-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
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
                            {planoPendente.editando ? (
                              <select value={item.plano_contas_id} onChange={(event) => updatePlanoItem(idx, 'plano_contas_id', Number(event.target.value))} className="max-w-44 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                {renderLookupOptions(lookups?.categorias)}
                              </select>
                            ) : (lookups?.categorias?.find((entry) => entry.id === item.plano_contas_id)?.nome || item.plano_contas_id)}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando ? (
                              <select value={item.conta_id ?? ''} onChange={(event) => updatePlanoItem(idx, 'conta_id', event.target.value ? Number(event.target.value) : null)} className="max-w-40 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="">-</option>
                                {renderLookupOptions(lookups?.contas)}
                              </select>
                            ) : (lookups?.contas?.find((entry) => entry.id === item.conta_id)?.nome || '-')}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando ? (
                              <select value={item.centro_custo_id ?? ''} onChange={(event) => updatePlanoItem(idx, 'centro_custo_id', event.target.value ? Number(event.target.value) : null)} className="max-w-40 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="">-</option>
                                {renderLookupOptions(lookups?.centros)}
                              </select>
                            ) : (lookups?.centros?.find((entry) => entry.id === item.centro_custo_id)?.nome || '-')}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {planoPendente.editando ? (
                              <select value={item.entidade_id ?? ''} onChange={(event) => updatePlanoItem(idx, 'entidade_id', event.target.value ? Number(event.target.value) : null)} className="max-w-44 rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <option value="">-</option>
                                {renderLookupOptions(lookups?.entidades)}
                              </select>
                            ) : (lookups?.entidades?.find((entry) => entry.id === item.entidade_id)?.nome || '-')}
                          </td>
                        </tr>
                      ))}
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
                    Confirmar e criar
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

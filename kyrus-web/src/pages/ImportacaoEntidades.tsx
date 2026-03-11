import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  UploadCloud,
  Users,
} from 'lucide-react';

import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';

type EntityKind = 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
type PersonKind = 'PF' | 'PJ';

interface ImportedEntityRow {
  rowNumber: number;
  nome: string;
  tipo: EntityKind;
  tipo_pessoa: PersonKind;
  nome_fantasia: string;
  cpf_cnpj: string;
  contato_nome: string;
  email: string;
  telefone: string;
  celular: string;
  cep: string;
  numero: string;
  complemento: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  observacoes: string;
  errors: string[];
}

interface FeedbackState {
  type: 'success' | 'error';
  message: string;
  details?: string[];
}

interface CepAddress {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

const TEMPLATE_HEADERS = [
  'nome',
  'tipo',
  'tipo_pessoa',
  'nome_fantasia',
  'cpf_cnpj',
  'contato_responsavel',
  'email',
  'telefone',
  'celular_whatsapp',
  'cep',
  'numero',
  'complemento',
  'logradouro',
  'bairro',
  'cidade',
  'uf',
  'observacoes',
];

const HEADER_ALIASES: Record<string, string[]> = {
  nome: ['nome', 'nome_completo', 'razao_social', 'razao social'],
  tipo: ['tipo', 'tipo_interessado', 'tipo interessado'],
  tipo_pessoa: ['tipo_pessoa', 'tipo pessoa'],
  nome_fantasia: ['nome_fantasia', 'nome fantasia', 'apelido'],
  cpf_cnpj: ['cpf_cnpj', 'cpf/cnpj', 'documento', 'cpf', 'cnpj'],
  contato_nome: ['contato_responsavel', 'contato responsavel', 'responsavel', 'contato_nome'],
  email: ['email', 'e-mail'],
  telefone: ['telefone', 'fone'],
  celular: ['celular_whatsapp', 'celular/whatsapp', 'celular', 'whatsapp'],
  cep: ['cep'],
  numero: ['numero', 'número'],
  complemento: ['complemento'],
  logradouro: ['logradouro', 'endereco', 'endereço', 'rua'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio', 'município'],
  uf: ['uf', 'estado'],
  observacoes: ['observacoes', 'observações', 'obs'],
};

function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeHeader(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeTipo(value: string): EntityKind {
  const normalized = normalizeHeader(value);
  if (normalized.includes('cliente')) return 'CLIENTE';
  if (normalized.includes('fornecedor')) return 'FORNECEDOR';
  return 'AMBOS';
}

function inferTipoPessoa(documento: string, current?: string): PersonKind {
  const digits = onlyDigits(documento);
  if (digits.length > 11) return 'PJ';
  if (digits.length > 0) return 'PF';
  return String(current || '').trim().toUpperCase() === 'PJ' ? 'PJ' : 'PF';
}

function nullableValue(value: string) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

async function fetchCepAddress(cep: string): Promise<CepAddress> {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) {
    throw new Error('CEP inválido');
  }

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!response.ok) {
    throw new Error('Falha ao consultar CEP');
  }

  const data = await response.json();
  if (data?.erro) {
    throw new Error('CEP não encontrado');
  }

  return {
    cep: digits,
    logradouro: String(data.logradouro || '').trim(),
    bairro: String(data.bairro || '').trim(),
    cidade: String(data.localidade || '').trim(),
    uf: String(data.uf || '').trim().toUpperCase().slice(0, 2),
  };
}

function getHeaderIndexMap(headerRow: ExcelJS.Row) {
  const indexMap = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = normalizeHeader(String(cell.value || ''));
    if (!key) return;
    indexMap.set(key, colNumber);
  });
  return indexMap;
}

function getMappedColumn(indexMap: Map<string, number>, target: string) {
  const aliases = HEADER_ALIASES[target] || [target];
  return aliases.map((alias) => normalizeHeader(alias)).find((alias) => indexMap.has(alias)) || null;
}

function getCellText(row: ExcelJS.Row, indexMap: Map<string, number>, target: string) {
  const mapped = getMappedColumn(indexMap, target);
  if (!mapped) return '';
  const cell = row.getCell(indexMap.get(mapped) || 0);
  return String(cell?.text || cell?.value || '').trim();
}

async function parseEntityWorkbook(file: File): Promise<ImportedEntityRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('A planilha não possui abas.');
  }

  const headerRow = worksheet.getRow(1);
  const indexMap = getHeaderIndexMap(headerRow);
  if (!getMappedColumn(indexMap, 'nome')) {
    throw new Error('A planilha precisa ter a coluna nome.');
  }

  const rows: ImportedEntityRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nome = getCellText(row, indexMap, 'nome');
    const documento = getCellText(row, indexMap, 'cpf_cnpj');
    const tipoPessoaRaw = getCellText(row, indexMap, 'tipo_pessoa');
    const cep = onlyDigits(getCellText(row, indexMap, 'cep')).slice(0, 8);
    const tipo = normalizeTipo(getCellText(row, indexMap, 'tipo'));
    const tipo_pessoa = inferTipoPessoa(documento, tipoPessoaRaw);

    const importedRow: ImportedEntityRow = {
      rowNumber,
      nome,
      tipo,
      tipo_pessoa,
      nome_fantasia: getCellText(row, indexMap, 'nome_fantasia'),
      cpf_cnpj: onlyDigits(documento).slice(0, 14),
      contato_nome: getCellText(row, indexMap, 'contato_nome'),
      email: getCellText(row, indexMap, 'email'),
      telefone: onlyDigits(getCellText(row, indexMap, 'telefone')).slice(0, 11),
      celular: onlyDigits(getCellText(row, indexMap, 'celular')).slice(0, 11),
      cep,
      numero: getCellText(row, indexMap, 'numero'),
      complemento: getCellText(row, indexMap, 'complemento'),
      logradouro: getCellText(row, indexMap, 'logradouro'),
      bairro: getCellText(row, indexMap, 'bairro'),
      cidade: getCellText(row, indexMap, 'cidade'),
      uf: getCellText(row, indexMap, 'uf').toUpperCase().slice(0, 2),
      observacoes: getCellText(row, indexMap, 'observacoes'),
      errors: [],
    };

    const isEmpty = Object.entries(importedRow)
      .filter(([key]) => !['rowNumber', 'errors', 'tipo', 'tipo_pessoa'].includes(key))
      .every(([, value]) => !String(value || '').trim());

    if (isEmpty) return;

    if (!importedRow.nome.trim()) {
      importedRow.errors.push('Nome é obrigatório.');
    }
    if (importedRow.cpf_cnpj && ![11, 14].includes(importedRow.cpf_cnpj.length)) {
      importedRow.errors.push('CPF/CNPJ deve ter 11 ou 14 dígitos.');
    }
    if (importedRow.cep && importedRow.cep.length !== 8) {
      importedRow.errors.push('CEP deve ter 8 dígitos.');
    }
    if (importedRow.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(importedRow.email)) {
      importedRow.errors.push('E-mail inválido.');
    }
    if (importedRow.uf && importedRow.uf.length !== 2) {
      importedRow.errors.push('UF deve ter 2 letras.');
    }

    rows.push(importedRow);
  });

  return rows;
}

export function ImportacaoEntidades() {
  const invalidateEntidades = useLookupStore((state) => state.invalidateEntidades);
  const invalidateEntidadesLookup = useLookupStore((state) => state.invalidateEntidadesLookup);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportedEntityRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const validRows = useMemo(() => rows.filter((row) => row.errors.length === 0), [rows]);
  const invalidRows = useMemo(() => rows.filter((row) => row.errors.length > 0), [rows]);

  async function handleDownloadTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Interessados');
    worksheet.addRow(TEMPLATE_HEADERS);
    worksheet.addRow([
      'Maria da Silva',
      'CLIENTE',
      'PF',
      '',
      '12345678901',
      'Maria da Silva',
      'maria@exemplo.com',
      '11933334444',
      '11999998888',
      '66000000',
      '123',
      'Apto 10',
      '',
      '',
      '',
      '',
      'Importado via planilha',
    ]);
    worksheet.columns = TEMPLATE_HEADERS.map((header) => ({ header, key: header, width: 22 }));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'modelo_importacao_interessados.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  async function handlePreview() {
    if (!file) return;
    setLoadingPreview(true);
    setFeedback(null);
    try {
      const parsed = await parseEntityWorkbook(file);
      setRows(parsed);
      setFeedback({
        type: parsed.some((row) => row.errors.length > 0) ? 'error' : 'success',
        message: `${parsed.length} interessado(s) lido(s) da planilha.`,
      });
    } catch (error: any) {
      setRows([]);
      setFeedback({ type: 'error', message: error?.message || 'Não foi possível ler a planilha.' });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    setFeedback(null);

    try {
      const uniqueCeps = Array.from(new Set(validRows.map((row) => row.cep).filter((cep) => cep.length === 8)));
      const cepEntries = await Promise.all(
        uniqueCeps.map(async (cep) => {
          try {
            return [cep, await fetchCepAddress(cep)] as const;
          } catch {
            return [cep, null] as const;
          }
        }),
      );
      const cepMap = new Map<string, CepAddress | null>(cepEntries);

      const payload = validRows.map((row) => {
        const cepAddress = row.cep ? cepMap.get(row.cep) : null;
        return {
          nome: row.nome.trim(),
          tipo: row.tipo,
          tipo_pessoa: row.tipo_pessoa,
          nome_fantasia: nullableValue(row.nome_fantasia),
          cpf_cnpj: nullableValue(row.cpf_cnpj),
          contato_nome: nullableValue(row.contato_nome),
          email: nullableValue(row.email),
          telefone: nullableValue(row.telefone),
          celular: nullableValue(row.celular),
          cep: nullableValue(row.cep),
          numero: nullableValue(row.numero),
          complemento: nullableValue(row.complemento),
          logradouro: nullableValue(row.logradouro) || cepAddress?.logradouro || null,
          bairro: nullableValue(row.bairro) || cepAddress?.bairro || null,
          cidade: nullableValue(row.cidade) || cepAddress?.cidade || null,
          uf: nullableValue(row.uf) || cepAddress?.uf || null,
          observacoes: nullableValue(row.observacoes),
          status: 'ATIVO',
        };
      });

      const { data } = await api.post('/entidades/bulk', payload);
      invalidateEntidades();
      invalidateEntidadesLookup();
      setFeedback({
        type: 'success',
        message: `${Array.isArray(data) ? data.length : validRows.length} interessado(s) processado(s) com sucesso.`,
        details: invalidRows.length > 0 ? [`${invalidRows.length} linha(s) ficaram de fora por inconsistências na planilha.`] : undefined,
      });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || error?.message || 'Erro ao importar interessados.' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-16">
      <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.15),transparent_35%),linear-gradient(135deg,#ffffff_0%,#f8fafc_48%,#ecfdf5_100%)] p-6 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_48%,rgba(20,83,45,0.2)_100%)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Users className="h-3.5 w-3.5" />
              Importação de interessados
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white">Importar Interessados</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Use uma planilha própria para clientes, fornecedores e demais interessados com CPF/CNPJ, contato responsável, e-mail, telefone, celular/WhatsApp, CEP e número. Quando o CEP vier preenchido, o sistema completa logradouro, bairro, cidade e UF automaticamente.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/importacao" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100 dark:hover:bg-slate-800">
              <ArrowLeft className="h-4 w-4" />
              Voltar para importações
            </Link>
            <button onClick={handleDownloadTemplate} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700">
              <Download className="h-4 w-4" />
              Baixar modelo
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div className={`rounded-2xl border px-4 py-4 ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300'}`}>
          <div className="flex items-start gap-3">
            {feedback.type === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
            <div>
              <p className="font-bold">{feedback.message}</p>
              {feedback.details && feedback.details.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {feedback.details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <UploadCloud className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Enviar planilha</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Trabalhe com o modelo padrão para evitar mapeamento manual e garantir a importação dos dados completos do interessado.</p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center transition hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-900/40">
            <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} className="absolute opacity-0 pointer-events-none" />
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <FileSpreadsheet className="h-8 w-8" />
            </div>
            <p className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{file ? file.name : 'Selecione a planilha de interessados'}</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Formato aceito: .xlsx. Colunas principais: nome, cpf_cnpj, contato_responsavel, email, telefone, celular_whatsapp, cep e numero.</p>
            <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
              <UploadCloud className="h-4 w-4" />
              Escolher arquivo
              <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} className="hidden" />
            </label>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Linhas lidas</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{rows.length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-500/10">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-500">Prontas</p>
              <p className="mt-2 text-3xl font-black text-emerald-700 dark:text-emerald-300">{validRows.length}</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-500/10">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-500">Com revisão</p>
              <p className="mt-2 text-3xl font-black text-red-700 dark:text-red-300">{invalidRows.length}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={handlePreview} disabled={!file || loadingPreview} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Ler planilha
            </button>
            <button onClick={handleImport} disabled={validRows.length === 0 || importing} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Importar interessados
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
              <MapPin className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Prévia da importação</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Revise documento, contato, canais e endereço. Quando só o CEP vier preenchido, o endereço é completado na etapa de importação.</p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700">
            <div className="max-h-136 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-left dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3 font-bold text-slate-500">Linha</th>
                    <th className="px-4 py-3 font-bold text-slate-500">Interessado</th>
                    <th className="px-4 py-3 font-bold text-slate-500">Contato</th>
                    <th className="px-4 py-3 font-bold text-slate-500">Endereço</th>
                    <th className="px-4 py-3 font-bold text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500 dark:text-slate-300">Leia uma planilha para exibir a prévia dos interessados.</td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.rowNumber} className="border-t border-slate-200 align-top dark:border-slate-700">
                        <td className="px-4 py-4 font-mono text-xs text-slate-400">#{row.rowNumber}</td>
                        <td className="px-4 py-4">
                          <p className="font-bold text-slate-900 dark:text-white">{row.nome || 'Sem nome'}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{row.tipo_pessoa} • {row.tipo}</p>
                          <p className="mt-1 text-xs text-slate-400">{row.cpf_cnpj || 'Sem CPF/CNPJ'}</p>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-300">
                          <p>{row.contato_nome || 'Sem responsável'}</p>
                          <p className="mt-1">{row.email || 'Sem e-mail'}</p>
                          <p className="mt-1">{row.telefone || row.celular || 'Sem telefone'}</p>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-300">
                          <p>{row.cep || 'Sem CEP'} {row.numero ? `• ${row.numero}` : ''}</p>
                          <p className="mt-1">{row.logradouro || 'Logradouro será buscado pelo CEP se estiver vazio'}</p>
                          <p className="mt-1">{[row.bairro, row.cidade, row.uf].filter(Boolean).join(' • ') || 'Bairro, cidade e UF serão buscados pelo CEP se estiverem vazios'}</p>
                        </td>
                        <td className="px-4 py-4">
                          {row.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Pronta para importar
                            </span>
                          ) : (
                            <div className="space-y-2">
                              <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Revisar linha
                              </span>
                              <ul className="space-y-1 text-xs text-red-600 dark:text-red-300">
                                {row.errors.map((error) => <li key={error}>{error}</li>)}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
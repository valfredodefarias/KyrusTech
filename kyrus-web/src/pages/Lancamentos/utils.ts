import { toPublicAssetUrl } from '../../services/api';
import type { Lancamento } from './types';

export const fixDate = (dateString: string) => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatDateExtenso = (dateString: string) => {
  if (!dateString) return '-';
  const date = fixDate(dateString);
  if (!date) return '-';
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'long' });
};

export const formatDateShort = (dateString?: string) => {
  if (!dateString) return '';
  const date = fixDate(dateString);
  return date ? date.toLocaleDateString('pt-BR') : '';
};

export const getTodayLocalYmd = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getTomorrowLocalYmd = () => {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getLocalYmdDaysAgo = (days: number) => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - days);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const isWeekend = (date: Date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

export const toNextBusinessDay = (ymd: string) => {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  if (!year || !month || !day) return ymd;
  const dt = new Date(year, month - 1, day);
  while (isWeekend(dt)) {
    dt.setDate(dt.getDate() + 1);
  }
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const parseDescricaoParcela = (descricao?: string) => {
  const text = String(descricao || '').trim();
  const match = text.match(/^(.*)\((\d+)\s*\/\s*(\d+)\)\s*$/);
  if (!match) return null;
  const base = String(match[1] || '').trim();
  const numero = Number(match[2] || 0);
  const total = Number(match[3] || 0);
  if (!base || numero <= 0 || total <= 1) return null;
  return { base, numero, total };
};

export const resolveAnexoUrl = (rawUrl?: string) => {
  const value = String(rawUrl || '').trim();
  if (!value) return '#';

  if (value.startsWith('/static/')) {
    return toPublicAssetUrl(value) || value;
  }

  if (/^https?:\/\/storage\.kyrus\.com\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 3 && /^\d+$/.test(parts[0] || '') && /^\d+$/.test(parts[1] || '')) {
        const empresaId = parts[0];
        const lancamentoId = parts[1];
        const fileName = parts.slice(2).join('/');
        const remapped = `/static/uploads/lancamentos/${empresaId}/${lancamentoId}/${fileName}`;
        return toPublicAssetUrl(remapped) || remapped;
      }
      return parsed.pathname || value;
    } catch {
      return '#';
    }
  }

  if (value.startsWith('/')) {
    return toPublicAssetUrl(value) || '#';
  }

  const safe = toPublicAssetUrl(value);
  return safe || '#';
};

export const isLancamentoAtrasado = (l: Lancamento) => {
  if (String(l.status).toUpperCase() === 'PAGO') return false;
  if (!l.data_vencimento) return false;
  return l.data_vencimento < getTodayLocalYmd();
};

export const isLancamentoPago = (l: Lancamento) => {
  if (String(l.status).toUpperCase() === 'PAGO') return true;
  if (Boolean(l.data_pagamento)) return true;
  if (Boolean(l.conciliado)) return true;
  return Number(l.valor_pago || 0) > 0;
};

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

export const formatCpfCnpj = (value: string) => {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

export const formatPhone = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
};

export const formatCep = (value: string) => onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

export const fetchCepAddress = async (cep: string) => {
  const digits = String(cep || '').replace(/\D/g, '');
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
};

export const nullableValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const formatCompetencia = (ymd?: string) => {
  if (!ymd) return '';
  const [y, m] = ymd.split('-');
  if (!y || !m) return '';
  return `${m}-${y}`;
};

export const isTransferencia = (lancamento?: Pick<Lancamento, 'origem'> | null) => 
  String(lancamento?.origem || '').toUpperCase() === 'TRANSFERENCIA';

export const getCategoriaLabel = (
  lancamento: Pick<Lancamento, 'origem' | 'plano_contas_id'>,
  categorias: any[]
) => {
  if (isTransferencia(lancamento)) return 'Transferência interna';
  return categorias.find(c => c.id === lancamento.plano_contas_id)?.nome || '-';
};

export const computeCartaoVencimento = (purchaseDate?: string, cartaoId?: string, cartoes: any[] = []) => {
  if (!purchaseDate || !cartaoId) return null;
  const cartao = cartoes.find(c => String(c.id) === String(cartaoId));
  if (!cartao) return null;
  const [y, m, d] = purchaseDate.split('-').map(Number);
  if (!y || !m || !d) return null;

  const fechamento = Number(cartao.dia_fechamento || 1);
  const venc = Number(cartao.dia_vencimento || 10);
  const statementOffset = d > fechamento ? 1 : 0;
  const dueOffset = statementOffset + (venc <= fechamento ? 1 : 0);
  const monthIndex = (m - 1) + dueOffset;
  const daysInMonth = new Date(y, monthIndex + 1, 0).getDate();
  const day = Math.min(venc, daysInMonth);
  
  const formatDateYMD = (date: Date) => {
    const dy = date.getFullYear();
    const dm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${dy}-${dm}-${dd}`;
  };

  return formatDateYMD(new Date(y, monthIndex, day));
};

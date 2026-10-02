/**
 * date.ts - Utilitários de datas e fusos horários locais para o KyrusERP
 * 
 * Evita bugs clássicos de conversão UTC (ex: new Date().toISOString().split('T')[0]
 * que avança para o dia seguinte a partir das 21:00 no Brasil UTC-3).
 */

/**
 * Retorna a data local no formato 'YYYY-MM-DD'.
 * Utiliza o relógio do dispositivo no fuso horário do usuário.
 */
export function getLocalDateString(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Retorna o mês local no formato 'YYYY-MM'.
 */
export function getLocalMonthString(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Extrai o mês 'YYYY-MM' de uma string de data 'YYYY-MM-DD' com segurança,
 * sem converter para objeto Date (o que poderia deslocar o dia/mês por causa do fuso horário).
 */
export function getMonthFromDateString(dateStr?: string | null): string {
  if (!dateStr) return getLocalMonthString();
  const trimmed = dateStr.trim();
  if (trimmed.length >= 7) {
    return trimmed.substring(0, 7);
  }
  return getLocalMonthString();
}

/**
 * Converte uma string 'YYYY-MM-DD' para objeto Date local (às 00:00:00 do fuso local).
 * Evita que o construtor Date("YYYY-MM-DD") interprete como UTC midnight e subtraia 3 horas no Brasil.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0);
}

/**
 * Formata 'YYYY-MM-DD' para 'DD/MM/YYYY'.
 */
export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '';
  const clean = dateStr.trim().split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/**
 * Parser de valores monetários que aceita:
 * - Formato brasileiro com vírgula decimal (ex: "50,75", "1.250,50")
 * - Formato internacional com ponto decimal (ex: "50.75", "1250.50")
 * - Expressões matemáticas simples (ex: "10+5,50", "20*2")
 * Retorna o número com precisão de 2 casas decimais (centavos exatos).
 */
export function parseMonetaryInput(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) / 100 : 0;
  }
  let str = String(input).trim();
  if (!str) return 0;

  // Se contiver vírgula, tratamos a vírgula como separador decimal pt-BR
  if (str.includes(',')) {
    // Remove pontos de milhar e substitui vírgula por ponto
    str = str.replace(/\./g, '').replace(/,/g, '.');
  }

  // Verifica se é uma expressão matemática simples contendo apenas dígitos, operadores e pontos
  if (/^[0-9+\-*/().\s]+$/.test(str)) {
    try {
      const res = Function(`"use strict"; return (${str})`)();
      if (typeof res === 'number' && Number.isFinite(res) && res >= 0) {
        return Math.round(res * 100) / 100;
      }
    } catch {}
  }

  const directNum = parseFloat(str);
  return Number.isFinite(directNum) && directNum >= 0 ? Math.round(directNum * 100) / 100 : 0;
}

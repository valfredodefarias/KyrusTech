/**
 * money.ts - Utilitários de Aritmética Financeira para o KyrusERP
 * 
 * Evita imprecisões de ponto flutuante em JavaScript tratando valores
 * internamente em centavos inteiros (integers) antes de converter para float/string.
 */

/**
 * Converte qualquer valor numérico ou string brasileira/americana para centavos inteiros.
 * Exemplos:
 *   100.50 -> 10050
 *   "100,50" -> 10050
 *   "1.234,56" -> 123456
 *   "1234.56" -> 123456
 */
export function toCents(val: number | string | null | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return 0;
    return Math.round(val * 100);
  }
  const str = String(val).trim();
  if (!str) return 0;

  // Tratar formato brasileiro "1.234,56" ou simples "100,50"
  if (str.includes(',')) {
    const clean = str.replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(clean);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }

  const parsed = parseFloat(str);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * Converte centavos inteiros de volta para float com 2 casas decimais.
 * Exemplo: 10050 -> 100.5
 */
export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/**
 * Arredonda qualquer número float para 2 casas decimais de forma estável.
 */
export function roundCurrency(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Divide um valor total em centavos entre N parcelas de forma exata.
 * O resto dos centavos é distribuído nas primeiras parcelas (padrão bancário brasileiro),
 * garantindo que a soma de todas as parcelas seja exatamente igual ao total original.
 * 
 * Exemplo: 10000 centavos (R$ 100,00) em 3 parcelas -> [3334, 3333, 3333] centavos
 * convertidos: [33.34, 33.33, 33.33]
 */
export function distributeCents(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [totalCents];

  const baseParcelCents = Math.floor(totalCents / count);
  let remainder = totalCents - baseParcelCents * count;

  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    if (remainder > 0) {
      result.push(baseParcelCents + 1);
      remainder -= 1;
    } else if (remainder < 0) {
      result.push(baseParcelCents - 1);
      remainder += 1;
    } else {
      result.push(baseParcelCents);
    }
  }
  return result;
}

/**
 * Divide um valor em reais (float ou string) em N parcelas exatas em reais.
 */
export function splitAmountIntoInstallments(totalAmount: number | string, count: number): number[] {
  const totalCents = toCents(totalAmount);
  const centsList = distributeCents(totalCents, count);
  return centsList.map(fromCents);
}

/**
 * Formata um valor numérico para o padrão de moeda Real Brasileiro (R$ 1.234,56).
 */
export function formatCurrencyBRL(val: number | string | null | undefined): string {
  const cents = toCents(val);
  const floatVal = fromCents(cents);
  return floatVal.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

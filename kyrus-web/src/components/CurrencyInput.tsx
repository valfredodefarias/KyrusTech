import type { InputHTMLAttributes } from 'react';

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string | number | null | undefined;
  onValueChange: (value: string) => void;
  allowNegative?: boolean;
};

function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

export function formatCurrencyDigitsToDecimalString(value: string) {
  const digits = onlyDigits(value);
  if (!digits) return '';

  const padded = digits.padStart(3, '0');
  const integerPart = padded.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  const decimalPart = padded.slice(-2);
  return `${integerPart}.${decimalPart}`;
}

function extractSignAndDigits(value: string, allowNegative: boolean) {
  const raw = String(value || '');
  const negative = allowNegative && raw.trim().startsWith('-');
  return {
    negative,
    digits: onlyDigits(raw),
  };
}

export function formatCurrencyInputValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';

  const normalized = String(value).replace(',', '.').trim();
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return '';

  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function CurrencyInput({ value, onValueChange, inputMode = 'decimal', allowNegative = false, ...props }: CurrencyInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode}
      value={formatCurrencyInputValue(value)}
      onChange={(event) => {
        const { negative, digits } = extractSignAndDigits(event.target.value, allowNegative);
        const decimalString = formatCurrencyDigitsToDecimalString(digits);
        if (!decimalString) {
          onValueChange('');
          return;
        }
        onValueChange(negative ? `-${decimalString}` : decimalString);
      }}
    />
  );
}
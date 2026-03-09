import type { CSSProperties } from 'react';

export type BrandVisual = {
  key: string;
  label: string;
  shortLabel: string;
  accent: string;
  background: string;
  text: string;
};

type BrandMatcher = BrandVisual & {
  aliases: string[];
};

interface BrandAvatarProps {
  visual: BrandVisual;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<BrandAvatarProps['size']>, string> = {
  sm: 'h-9 w-9 text-[11px]',
  md: 'h-12 w-12 text-xs',
  lg: 'h-14 w-14 text-sm',
};

const BANK_BRANDS: BrandMatcher[] = [
  {
    key: 'itau',
    label: 'Itaú',
    shortLabel: 'IT',
    accent: '#f97316',
    background: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)',
    text: '#9a3412',
    aliases: ['itau', 'itaú'],
  },
  {
    key: 'bradesco',
    label: 'Bradesco',
    shortLabel: 'BR',
    accent: '#be123c',
    background: 'linear-gradient(135deg, #fff1f2 0%, #fecdd3 100%)',
    text: '#9f1239',
    aliases: ['bradesco'],
  },
  {
    key: 'santander',
    label: 'Santander',
    shortLabel: 'SA',
    accent: '#dc2626',
    background: 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
    text: '#991b1b',
    aliases: ['santander'],
  },
  {
    key: 'bb',
    label: 'Banco do Brasil',
    shortLabel: 'BB',
    accent: '#ca8a04',
    background: 'linear-gradient(135deg, #fefce8 0%, #fde68a 100%)',
    text: '#854d0e',
    aliases: ['banco do brasil', 'bb brasil', 'bb '],
  },
  {
    key: 'caixa',
    label: 'Caixa',
    shortLabel: 'CX',
    accent: '#2563eb',
    background: 'linear-gradient(135deg, #eff6ff 0%, #bfdbfe 100%)',
    text: '#1d4ed8',
    aliases: ['caixa economica', 'caixa econômica', 'caixa'],
  },
  {
    key: 'nubank',
    label: 'Nubank',
    shortLabel: 'NU',
    accent: '#7c3aed',
    background: 'linear-gradient(135deg, #f5f3ff 0%, #ddd6fe 100%)',
    text: '#6d28d9',
    aliases: ['nubank', 'nu bank', 'nuconta'],
  },
  {
    key: 'inter',
    label: 'Inter',
    shortLabel: 'IN',
    accent: '#ea580c',
    background: 'linear-gradient(135deg, #fff7ed 0%, #fdba74 100%)',
    text: '#c2410c',
    aliases: ['banco inter', 'inter'],
  },
  {
    key: 'sicredi',
    label: 'Sicredi',
    shortLabel: 'SI',
    accent: '#16a34a',
    background: 'linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)',
    text: '#15803d',
    aliases: ['sicredi'],
  },
  {
    key: 'sicoob',
    label: 'Sicoob',
    shortLabel: 'SC',
    accent: '#0f766e',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #99f6e4 100%)',
    text: '#115e59',
    aliases: ['sicoob'],
  },
  {
    key: 'asaas',
    label: 'Asaas',
    shortLabel: 'AS',
    accent: '#0891b2',
    background: 'linear-gradient(135deg, #ecfeff 0%, #a5f3fc 100%)',
    text: '#0e7490',
    aliases: ['asaas'],
  },
];

const CARD_BRANDS: BrandMatcher[] = [
  {
    key: 'visa',
    label: 'Visa',
    shortLabel: 'VI',
    accent: '#1d4ed8',
    background: 'linear-gradient(135deg, #eff6ff 0%, #bfdbfe 100%)',
    text: '#1e3a8a',
    aliases: ['visa'],
  },
  {
    key: 'mastercard',
    label: 'Mastercard',
    shortLabel: 'MC',
    accent: '#dc2626',
    background: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)',
    text: '#9a3412',
    aliases: ['mastercard', 'master', 'master card'],
  },
  {
    key: 'elo',
    label: 'Elo',
    shortLabel: 'EL',
    accent: '#0f766e',
    background: 'linear-gradient(135deg, #ecfeff 0%, #99f6e4 100%)',
    text: '#115e59',
    aliases: ['elo'],
  },
  {
    key: 'amex',
    label: 'Amex',
    shortLabel: 'AX',
    accent: '#0284c7',
    background: 'linear-gradient(135deg, #f0f9ff 0%, #bae6fd 100%)',
    text: '#075985',
    aliases: ['amex', 'american express'],
  },
  {
    key: 'hipercard',
    label: 'Hipercard',
    shortLabel: 'HI',
    accent: '#b91c1c',
    background: 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
    text: '#991b1b',
    aliases: ['hipercard', 'hiper'],
  },
  {
    key: 'cabal',
    label: 'Cabal',
    shortLabel: 'CB',
    accent: '#4338ca',
    background: 'linear-gradient(135deg, #eef2ff 0%, #c7d2fe 100%)',
    text: '#3730a3',
    aliases: ['cabal'],
  },
  {
    key: 'pix',
    label: 'Pix',
    shortLabel: 'PX',
    accent: '#0f766e',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #99f6e4 100%)',
    text: '#115e59',
    aliases: ['pix'],
  },
];

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findBrand(matchers: BrandMatcher[], values: Array<string | null | undefined>) {
  const haystack = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');

  if (!haystack) return null;

  return matchers.find((brand) => brand.aliases.some((alias) => haystack.includes(normalizeText(alias)))) || null;
}

function buildFallback(label: string, shortLabel: string, accent: string, background: string, text: string): BrandVisual {
  return {
    key: shortLabel.toLowerCase(),
    label,
    shortLabel,
    accent,
    background,
    text,
  };
}

export function inferBankBrand(...values: Array<string | null | undefined>): BrandVisual {
  const bank = findBrand(BANK_BRANDS, values);
  if (bank) return bank;

  const rawLabel = values.find((value) => normalizeText(value)) || 'Conta';
  const label = String(rawLabel).trim() || 'Conta';
  const shortLabel =
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'CT';

  return buildFallback(label, shortLabel, '#475569', 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)', '#334155');
}

export function inferCardBrand(...values: Array<string | null | undefined>): BrandVisual {
  const cardBrand = findBrand(CARD_BRANDS, values);
  if (cardBrand) return cardBrand;

  const rawLabel = values.find((value) => normalizeText(value)) || 'Cartão';
  const label = String(rawLabel).trim() || 'Cartão';
  const shortLabel =
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'CR';

  return buildFallback(label, shortLabel, '#0f172a', 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)', '#0f172a');
}

export const CARD_BRAND_OPTIONS = CARD_BRANDS.map((brand) => ({
  value: brand.label.toUpperCase(),
  label: brand.label,
  visual: brand as BrandVisual,
}));

export function BrandAvatar({ visual, size = 'md', className = '' }: BrandAvatarProps) {
  const style = {
    background: visual.background,
    color: visual.text,
    borderColor: `${visual.accent}33`,
    boxShadow: `inset 0 0 0 1px ${visual.accent}22`,
  } as CSSProperties;

  return (
    <div
      className={`flex items-center justify-center rounded-2xl border font-black uppercase tracking-[0.18em] ${SIZE_CLASS[size]} ${className}`}
      style={style}
      title={visual.label}
    >
      {visual.shortLabel}
    </div>
  );
}
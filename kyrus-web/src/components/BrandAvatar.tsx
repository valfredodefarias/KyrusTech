import { useMemo, useState } from 'react';
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
    aliases: ['banco do brasil', 'bb brasil', 'bb ', 'banco brasil'],
  },
  {
    key: 'banpara',
    label: 'Banpará',
    shortLabel: 'BP',
    accent: '#16a34a',
    background: 'linear-gradient(135deg, #f0fdf4 0%, #86efac 100%)',
    text: '#166534',
    aliases: ['banpara', 'banpará', 'banco do estado do para'],
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
    key: 'picpay',
    label: 'PicPay',
    shortLabel: 'PP',
    accent: '#22c55e',
    background: 'linear-gradient(135deg, #ecfdf5 0%, #86efac 100%)',
    text: '#166534',
    aliases: ['picpay', 'pic pay'],
  },
  {
    key: 'c6',
    label: 'C6 Bank',
    shortLabel: 'C6',
    accent: '#0f172a',
    background: 'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)',
    text: '#0f172a',
    aliases: ['c6 bank', 'c6bank', 'c6'],
  },
  {
    key: 'mercadopago',
    label: 'Mercado Pago',
    shortLabel: 'MP',
    accent: '#0ea5e9',
    background: 'linear-gradient(135deg, #ecfeff 0%, #93c5fd 100%)',
    text: '#0c4a6e',
    aliases: ['mercado pago', 'mercadopago'],
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

function buildPublicLogoUrl(path: string) {
  if (!path) return null;
  return path.startsWith('/') ? path : `/${path}`;
}

export function getBankDefaultLogoPath(...values: Array<string | null | undefined>) {
  const bank = findBrand(BANK_BRANDS, values);
  if (!bank) return null;

  const logoMap: Record<string, string> = {
    itau: '/itau.png',
    asaas: '/asaas-acelerados.png',
    bradesco: '/bank-logos/bradesco.png',
    santander: '/bank-logos/santander.png',
    bb: '/bank-logos/banco-do-brasil.png',
    banpara: '/bank-logos/banpara.png',
    caixa: '/bank-logos/caixa.png',
    nubank: '/bank-logos/nubank.png',
    inter: '/bank-logos/inter.png',
    sicredi: '/bank-logos/sicredi.png',
    sicoob: '/bank-logos/sicoob.png',
    picpay: '/bank-logos/picpay.png',
    c6: '/bank-logos/c6-bank.png',
    mercadopago: '/bank-logos/mercado-pago.png',
  };

  return buildPublicLogoUrl(logoMap[bank.key] || '');
}

interface BankAvatarProps {
  logoUrl?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  integrationType?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

export function BankAvatar({
  logoUrl,
  bankName,
  accountName,
  integrationType,
  size = 'md',
  className = '',
  imageClassName = 'rounded-2xl',
  fallbackClassName = '',
}: BankAvatarProps) {
  const visual = inferBankBrand(bankName, accountName, integrationType);
  const defaultLogoPath = useMemo(() => getBankDefaultLogoPath(bankName, accountName, integrationType), [bankName, accountName, integrationType]);
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});

  const imageSrc = useMemo(() => {
    const candidates = [logoUrl, defaultLogoPath].filter(Boolean) as string[];
    return candidates.find((candidate) => !failedSources[candidate]) || null;
  }, [defaultLogoPath, failedSources, logoUrl]);

  if (imageSrc) {
    return (
      <div className={`overflow-hidden ${SIZE_CLASS[size]} ${className}`} title={visual.label}>
        <img
          src={imageSrc}
          alt={accountName || bankName || visual.label}
          className={`h-full w-full object-cover ${imageClassName}`}
          onError={() => setFailedSources((prev) => ({ ...prev, [imageSrc]: true }))}
        />
      </div>
    );
  }

  return <BrandAvatar visual={visual} size={size} className={`${fallbackClassName} ${className}`.trim()} />;
}
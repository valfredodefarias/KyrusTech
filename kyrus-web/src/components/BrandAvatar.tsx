import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { toPublicAssetUrl } from '../services/api';
import { useBankPresetStore } from '../store/bankPresetStore';

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
  {
    key: 'ifood',
    label: 'iFood',
    shortLabel: 'IF',
    accent: '#ea1d2c',
    background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
    text: '#b91c1c',
    aliases: ['ifood'],
  },
];

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchBankPreset(
  presets: Array<{ bank_name: string; label: string; aliases: string[]; logo_url?: string | null; is_active: boolean }>,
  values: Array<string | null | undefined>,
) {
  const normalizedValues = values
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const haystack = normalizedValues.join(' ');

  if (!haystack) return null;

  return presets.find((preset) => {
    if (!preset.is_active) return false;
    const terms = [preset.bank_name, preset.label, ...(preset.aliases || [])]
      .map((value) => normalizeText(value))
      .filter((term) => Boolean(term) && term.length >= 3);
    return terms.some((term) => normalizedValues.some((value) => value === term || value.includes(term) || (value.length >= 5 && term.includes(value))));
  }) || null;
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

const BrandSvgLogo = ({ brandKey, size = 'md' }: { brandKey: string; size?: 'sm' | 'md' | 'lg' }) => {
  const normalizedKey = brandKey.toLowerCase();
  
  let dims = 'h-4.5 w-7.5';
  if (size === 'sm') dims = 'h-3.5 w-6';
  if (size === 'lg') dims = 'h-6 w-10';
  
  if (normalizedKey === 'pix') {
    dims = size === 'sm' ? 'h-4.5 w-4.5' : size === 'md' ? 'h-5.5 w-5.5' : 'h-7 w-7';
  }

  switch (normalizedKey) {
    case 'visa':
      return (
        <svg viewBox="0 0 24 15" className={`${dims} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10.02 0.28H7.4L4.62 10.9L3.48 2.05C3.39 1.41 2.91 0.77 2.16 0.44C1.3 0.05 0.32 -0.16 0 0.05L0.08 0.42C0.63 0.63 1.25 1.05 1.51 1.76L3.4 12.87H6.18L10.39 0.28H10.02ZM15.7 3.51C15.7 1.83 13.9 1.48 12.55 1.05C11.14 0.61 9.4 0.28 9.4 1.88C9.4 3.01 10.92 3.42 12.33 3.86C13.8 4.3 15.7 4.7 15.7 3.51ZM14.9 8.27C14.9 5.37 11.75 4.97 9.8 4.41C7.89 3.86 5.8 3.51 5.8 5.75C5.8 7.37 7.7 8.04 9.68 8.6C11.64 9.15 14.9 9.38 14.9 8.27ZM20.87 0.28H18.72C17.75 0.28 17.15 0.94 16.92 1.76L13.56 12.87H16.32L16.87 10.9H20.24L20.57 12.87H23L20.87 0.28ZM17.47 8.44L18.55 4.67C18.55 4.67 18.76 3.96 18.9 3.32L19.46 8.44H17.47ZM23.36 0.28L21.36 12.87H24L26 0.28H23.36Z" fill="#1A1F71"/>
        </svg>
      );
    case 'mastercard':
      return (
        <svg viewBox="0 0 24 15" className={`${dims} shrink-0`} xmlns="http://www.w3.org/2000/svg">
          <circle cx="7.5" cy="7.5" r="7.5" fill="#EB001B" />
          <circle cx="16.5" cy="7.5" r="7.5" fill="#F79E1B" opacity="0.85" />
          <path d="M12 7.5a7.48 7.48 0 0 1 2.37-5.38 7.48 7.48 0 0 0-4.74 0A7.48 7.48 0 0 1 12 7.5z" fill="#FF5F00" />
        </svg>
      );
    case 'elo':
      return (
        <svg viewBox="0 0 24 15" className={`${dims} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 10.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="#EA580C" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M8 10.5c0-2 2-3 4-3s4 1 4 3" stroke="#FACC15" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="10.5" r="2" fill="#2563EB" />
        </svg>
      );
    case 'amex':
      return (
        <svg viewBox="0 0 24 15" className={`${dims} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="15" rx="2" fill="#0070CD" />
          <text x="12" y="9.5" fill="#FFFFFF" fontSize="6" fontWeight="bold" fontFamily="system-ui, sans-serif" textAnchor="middle" letterSpacing="0.2">AMEX</text>
        </svg>
      );
    case 'hipercard':
      return (
        <svg viewBox="0 0 24 15" className={`${dims} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="15" rx="2" fill="#C1121F" />
          <text x="12" y="9" fill="#FFFFFF" fontSize="5" fontWeight="black" fontFamily="system-ui, sans-serif" textAnchor="middle" letterSpacing="0.1">HIPER</text>
        </svg>
      );
    case 'cabal':
      return (
        <svg viewBox="0 0 24 15" className={`${dims} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="15" rx="2" fill="#1E3A8A" />
          <circle cx="9" cy="7.5" r="3.2" fill="#EF4444" opacity="0.8" />
          <circle cx="15" cy="7.5" r="3.2" fill="#3B82F6" opacity="0.8" />
          <path d="M12 5.5a2.5 2.5 0 0 1 0 4 2.5 2.5 0 0 1 0-4z" fill="#FFFFFF" />
        </svg>
      );
    case 'pix':
      return (
        <svg viewBox="0 0 24 24" className={`${dims} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 12l10 10 10-10L12 2zm0 3.8L18.2 12 12 18.2 5.8 12 12 5.8z" fill="#32BCAD" />
          <path d="M12 8.5L8.5 12l3.5 3.5 3.5-3.5-3.5-3.5z" fill="#32BCAD" />
        </svg>
      );
    default:
      return null;
  }
};

export function BrandAvatar({ visual, size = 'md', className = '' }: BrandAvatarProps) {
  const style = {
    background: visual.background,
    color: visual.text,
    borderColor: `${visual.accent}33`,
    boxShadow: `inset 0 0 0 1px ${visual.accent}22`,
  } as CSSProperties;

  const svgLogo = BrandSvgLogo({ brandKey: visual.key, size });

  return (
    <div
      className={`flex items-center justify-center rounded-md border font-black uppercase tracking-[0.18em] overflow-hidden ${SIZE_CLASS[size]} ${className}`}
      style={style}
      title={visual.label}
    >
      {svgLogo ? svgLogo : visual.shortLabel}
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
  imageFit?: 'cover' | 'contain';
}

export function BankAvatar({
  logoUrl,
  bankName,
  accountName,
  integrationType,
  size = 'md',
  className = '',
  imageClassName = 'rounded-md',
  fallbackClassName = '',
  imageFit = 'cover',
}: BankAvatarProps) {
  const visual = inferBankBrand(bankName, accountName, integrationType);
  const presets = useBankPresetStore((state) => state.presets);
  const presetsLoaded = useBankPresetStore((state) => state.loaded);
  const fetchPresets = useBankPresetStore((state) => state.fetchPresets);
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});

  useEffect(() => {
    if (!presetsLoaded) {
      void fetchPresets();
    }
  }, [fetchPresets, presetsLoaded]);

  const presetLogoPath = useMemo(() => {
    const preset = matchBankPreset(presets, [bankName, accountName, integrationType]);
    return toPublicAssetUrl(preset?.logo_url || null);
  }, [accountName, bankName, integrationType, presets]);

  const explicitLogoSrc = useMemo(() => toPublicAssetUrl(logoUrl), [logoUrl]);
  const defaultLogoPath = useMemo(
    () => presetLogoPath || getBankDefaultLogoPath(bankName, accountName, integrationType),
    [bankName, accountName, integrationType, presetLogoPath],
  );

  const imageSrc = useMemo(() => {
    const candidates = [explicitLogoSrc, defaultLogoPath].filter(Boolean) as string[];
    return candidates.find((candidate) => !failedSources[candidate]) || null;
  }, [defaultLogoPath, explicitLogoSrc, failedSources]);

  if (imageSrc) {
    return (
      <div className={`overflow-hidden ${SIZE_CLASS[size]} ${className}`} title={visual.label}>
        <img
          src={imageSrc}
          alt={accountName || bankName || visual.label}
          className={`h-full w-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'} ${imageClassName}`}
          onError={() => setFailedSources((prev) => ({ ...prev, [imageSrc]: true }))}
        />
      </div>
    );
  }

  return <BrandAvatar visual={visual} size={size} className={`${fallbackClassName} ${className}`.trim()} />;
}
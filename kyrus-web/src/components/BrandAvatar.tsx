import type { CSSProperties } from 'react';
import type { BrandVisual } from '../lib/branding';

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
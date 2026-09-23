import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

// The redesign's controls are tightened from pills to the 8px radius step and sit on a
// pressable edge. `ghost` stays flat: a borderless text control with a 3D edge reads as a
// floating artefact rather than a button.
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none';

// .btn-3d reads these three per-element; without --b-edge the depth is invisible.
const GLOW = '[--b-glow:var(--tt-glow)] [--b-glow-strong:var(--tt-glow-strong)]';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `bg-accent text-white hover:bg-accent-hover btn-3d [--b-edge:var(--tt-accent-edge)] ${GLOW}`,
  secondary: `bg-surface-raised border-separator text-text-secondary hover:text-text hover:border-text-secondary border btn-3d [--b-edge:var(--tt-border-strong)] ${GLOW}`,
  destructive: `bg-destructive text-white hover:opacity-90 btn-3d [--b-edge:var(--tt-destructive-edge)] ${GLOW}`,
  ghost: 'text-text-secondary hover:text-text hover:bg-hover',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'text-caption px-3 py-[5px]',
  sm: 'text-caption px-[13px] py-[6px]',
  md: 'text-label px-[17px] py-2',
};

/**
 * The shared button styling recipe: base + variant + size. Exported so the two kinds of control that
 * cannot adopt the `Button` component itself — interactive `onClick` toggles and `next/link` links —
 * can render the exact same look by applying this to their own `className`.
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

/**
 * A square icon-only control in the same language: the secondary variant's surface and pressable
 * edge, sized to its glyph instead of to text. The chrome toggles and small row affordances use
 * this so an icon button is visibly the same kind of thing as a labelled one.
 */
export function iconButtonClasses(size: 'sm' | 'md' = 'md'): string {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  return `${BASE} ${VARIANTS.secondary} ${box} flex-none p-0`;
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className' | 'children' | 'onClick' | 'onClickCapture'
  > & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'className' | 'children' | 'onClick' | 'onClickCapture'
  > & {
    href: string;
  };

/**
 * The one button primitive: renders `<a>` when `href` is set (links, downloads), else `<button>`
 * (form submits). Presentational and function-prop-free by design so it can be dropped into both
 * Server pages and `'use client'` action forms. Interactive toggles that need `onClick` keep their
 * own raw markup — this component does not take `onClick`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonAsButton | ButtonAsLink) {
  const cls = `${buttonClasses(variant, size)} ${className}`.trim();
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

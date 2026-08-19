import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-surface-raised border-separator text-text hover:border-text-secondary border',
  destructive: 'bg-destructive text-white hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'text-caption px-2.5 py-[5px]',
  sm: 'text-caption px-3 py-1.5',
  md: 'text-label px-3 py-[7px]',
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

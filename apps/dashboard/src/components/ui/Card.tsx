import type { ReactNode } from 'react';

/**
 * The raised surface of the design system: 10px radius, hairline separator border,
 * elevation-1 shadow, surface-raised background. `padding='md'` applies the standard panel
 * padding from the handoff (20px block / 22px inline); `padding='none'` (default) preserves
 * the existing behavior where callers pass their own.
 */
export function Card({
  children,
  className = '',
  padding = 'none',
}: {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'md';
}) {
  const pad = padding === 'md' ? 'px-[22px] py-5' : '';
  return (
    <div
      className={`bg-surface-raised border-separator rounded-md border shadow-e1 ${pad} ${className}`}
    >
      {children}
    </div>
  );
}

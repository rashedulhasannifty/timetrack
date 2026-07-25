import type { ReactNode } from 'react';

/**
 * The raised surface of the design system: rounded-lg (14px), hairline separator border,
 * elevation-1 shadow, surface-raised background. `padding='md'` applies the standard 18px panel
 * padding; `padding='none'` (default) preserves the existing behavior where callers pass their own.
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
  const pad = padding === 'md' ? 'p-[18px]' : '';
  return (
    <div
      className={`bg-surface-raised border-separator rounded-lg border shadow-e1 ${pad} ${className}`}
    >
      {children}
    </div>
  );
}

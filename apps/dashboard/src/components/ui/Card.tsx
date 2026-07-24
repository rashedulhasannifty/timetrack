import type { ReactNode } from 'react';

/**
 * The raised surface of the design system: rounded-lg (14px), hairline separator border,
 * elevation-1 shadow, surface-raised background. The building block for every panel and
 * stat card. Pass `className` to add padding/layout per use.
 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-raised border-separator rounded-lg border shadow-e1 ${className}`}>
      {children}
    </div>
  );
}

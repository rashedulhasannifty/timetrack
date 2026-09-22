'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { IconClose } from './icons';

/**
 * Off-canvas detail panel.
 *
 * Presentational: `open` and `onClose` belong to the caller, so one component serves both a
 * page-local drawer over already-loaded data and an intercepted route, where "open" means
 * "this URL is showing". Note that `onClose` is a function — a Server Component therefore
 * cannot render this directly; see RouteDrawer (Phase 7).
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  // Escape closes. Bound on the window so it fires wherever focus happens to sit.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock the page behind the panel. This restores the PREVIOUS value rather than clearing the
  // property, so opening a drawer over something else that locked scrolling does not unlock
  // the page early when this one closes.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-[80] bg-black/30" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-surface-raised shadow-e2 fixed inset-y-0 right-0 z-[90] flex w-full max-w-[520px] flex-col rounded-l-lg"
      >
        <div className="border-separator flex items-center gap-3 border-b px-[26px] py-[18px]">
          <span id={titleId} className="text-h3 font-bold">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="text-text-secondary hover:text-text ml-auto grid h-8 w-8 flex-none place-items-center rounded-md"
          >
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-[26px] py-5">{children}</div>
        {footer ? <div className="border-separator border-t px-[26px] py-4">{footer}</div> : null}
      </aside>
    </>
  );
}

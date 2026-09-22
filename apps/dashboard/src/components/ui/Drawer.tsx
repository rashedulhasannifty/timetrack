'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';
import { nextFocusTarget } from '../../lib/focus-trap';

// Standard interactive-element list for a hand-rolled focus trap. querySelectorAll only
// returns descendants, so the panel itself (tabIndex={-1}) never shows up here.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const panelRef = useRef<HTMLElement>(null);

  // Escape closes. Bound on the window so it fires wherever focus happens to sit.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the panel on open, and return it to whatever had focus before — if that
  // element is still around — on close or unmount. Skips stealing focus when something inside
  // the panel already has it (e.g. the caller focused a field itself before opening).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const activeElement = document.activeElement as HTMLElement | null;
    const alreadyInside = !!(panel && activeElement && panel.contains(activeElement));
    const previous = alreadyInside ? null : activeElement;

    if (!alreadyInside) panel?.focus();

    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  // Tab / Shift+Tab cycle through the panel's own focusable elements — a small hand-rolled
  // trap so focus never leaks to the page (or browser chrome) behind the backdrop. Focusables
  // are queried fresh on each keydown rather than cached, since the panel's content is
  // caller-supplied and can change while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = nextFocusTarget(focusables, current, e.shiftKey);
      e.preventDefault();
      (target ?? panel).focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Focusable so initial focus can land on the panel itself rather than guessing at a
        // "first" interactive descendant — Drawer's content is caller-supplied and varies from
        // read-only detail views to forms, and landing on an arbitrary (possibly destructive or
        // edit) control by default would be worse than landing on the dialog boundary. This also
        // means a screen reader announces the dialog's role and aria-labelledby name on open.
        tabIndex={-1}
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

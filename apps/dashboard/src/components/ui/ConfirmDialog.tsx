'use client';

import { useEffect, useId, useRef } from 'react';
import { buttonClasses, type ButtonVariant } from './Button';

/**
 * In-app confirmation modal — the dashboard's replacement for `window.confirm()`, which renders
 * as an unstyled browser alert. Built on the native <dialog> via showModal(), so focus moves into
 * it, the page behind is inert, and Escape cancels, without a focus-trap library.
 *
 * Controlled: the parent owns `open`. Escape, Cancel and a click on the backdrop all call
 * `onCancel`, and the parent decides what a cancel undoes. Cancel takes initial focus, so a
 * stray Enter never confirms a consequential change.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape fires `cancel`; route it through the parent so its state stays the source of truth.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // A click whose target is the <dialog> itself landed on the backdrop, not the panel.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="bg-surface-raised border-separator text-text shadow-e1 m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border p-0 backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-body font-semibold">
          {title}
        </h2>
        <p className="text-text-secondary text-label whitespace-pre-line">{message}</p>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className={buttonClasses('secondary', 'sm')}
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={buttonClasses(confirmVariant, 'sm')}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Split confirm text written for `window.confirm()` — a question on the first line, detail
 * after — into the modal's title and body, so existing wording helpers carry over unchanged.
 */
export function splitConfirmText(text: string): { title: string; message: string } {
  const [title = '', ...rest] = text.split('\n');
  return { title, message: rest.join('\n').trim() };
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconClose } from './icons';

export type ToastTone = 'good' | 'destructive';
type Toast = { id: string; message: string; tone: ToastTone };

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const LIFETIME_MS = 4000;

/**
 * Action feedback.
 *
 * A Server Action cannot call useToast — hooks do not exist on the server. The convention is
 * the one ConfirmDialog already follows: the action returns a result, and the client form
 * component that awaited it raises the toast.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keyed by toast id (not a flat array, as before) so a dismiss — manual or on timeout — can
  // clear that one toast's own timer without disturbing anyone else's.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, tone: ToastTone = 'good') => {
    const id = crypto.randomUUID();
    setToasts((cur) => [...cur, { id, message, tone }]);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, LIFETIME_MS),
    );
  }, []);

  // Shared row markup for both live regions below. The container stays `pointer-events-none`
  // so it never blocks clicks on whatever is underneath it, but that means each toast has to
  // opt back in with `pointer-events-auto` or its own dismiss button would be unclickable.
  const row = (t: Toast) => (
    <div
      key={t.id}
      className={`bg-surface-raised border-separator shadow-e2 text-label pointer-events-auto flex items-center gap-2 rounded-md border px-4 py-2.5 font-semibold ${
        t.tone === 'destructive' ? 'text-destructive' : 'text-good'
      }`}
    >
      <span>{t.message}</span>
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        aria-label="Dismiss notification"
        className="text-neutral hover:text-text ml-1 grid h-5 w-5 flex-none place-items-center rounded"
      >
        <IconClose width={14} height={14} />
      </button>
    </div>
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {/* Two live regions, not one. Destructive toasts get their own `role="alert"` region
            rather than joining the polite one below: `role="alert"` is implicitly assertive +
            atomic, and — unlike `aria-live="polite"`, which needs the region to already exist
            before content lands in it — most screen readers announce it correctly even when
            the element and its content are inserted together, so a failure gets read out
            promptly instead of being queued behind whatever else is on screen. Both regions
            are still mounted up front and stay empty until something fires, so the original
            always-mounted guarantee — a live region added at the same moment as its first
            message is not reliably announced — holds for the polite one exactly as before. */}
        <div aria-live="polite" className="flex flex-col gap-2">
          {toasts.filter((t) => t.tone !== 'destructive').map(row)}
        </div>
        <div role="alert" className="flex flex-col gap-2">
          {toasts.filter((t) => t.tone === 'destructive').map(row)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return push;
}

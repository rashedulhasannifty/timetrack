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
  // Tracked so unmounting mid-flight cannot setState on a dead component.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const push = useCallback((message: string, tone: ToastTone = 'good') => {
    const id = crypto.randomUUID();
    setToasts((cur) => [...cur, { id, message, tone }]);
    timers.current.push(
      setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), LIFETIME_MS),
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* The region is in the DOM even when empty: a live region inserted at the same moment
          as its first message is not reliably announced. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`bg-surface-raised border-separator shadow-e2 text-label rounded-md border px-4 py-2.5 font-semibold ${
              t.tone === 'destructive' ? 'text-destructive' : 'text-good'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return push;
}

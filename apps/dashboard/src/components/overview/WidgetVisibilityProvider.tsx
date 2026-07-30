'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const KEY = 'tt-widgets';
type Ctx = { isOn: (id: string) => boolean; toggle: (id: string) => void };
const WidgetCtx = createContext<Ctx | null>(null);

/** Holds a {widgetId: false} map of HIDDEN widgets in localStorage. Absent id = visible (default on). */
export function WidgetVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHidden(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* private mode / bad JSON — default to all visible */
    }
  }, []);

  const isOn = useCallback((id: string) => hidden[id] !== true, [hidden]);
  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return <WidgetCtx.Provider value={{ isOn, toggle }}>{children}</WidgetCtx.Provider>;
}

export function useWidgetVisibility(): Ctx {
  const ctx = useContext(WidgetCtx);
  if (!ctx) throw new Error('useWidgetVisibility must be used within WidgetVisibilityProvider');
  return ctx;
}

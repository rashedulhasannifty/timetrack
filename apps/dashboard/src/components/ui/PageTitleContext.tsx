'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The header's title and its "kicker" — the quiet line above it that says what the page is
 * for. Both are page-owned because only the page knows the subject (a person's name, the team
 * whose policy is open); the header falls back to a route map when a page sets neither.
 */
export type PageMeta = { title: string | null; kicker: string | null };

type Ctx = PageMeta & { setMeta: (m: PageMeta) => void };
const PageTitleCtx = createContext<Ctx | null>(null);

export function TitleProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({ title: null, kicker: null });
  const value = useMemo(() => ({ ...meta, setMeta }), [meta]);
  return <PageTitleCtx.Provider value={value}>{children}</PageTitleCtx.Provider>;
}

export function usePageTitle(): string | null {
  return useContext(PageTitleCtx)?.title ?? null;
}

export function usePageKicker(): string | null {
  return useContext(PageTitleCtx)?.kicker ?? null;
}

/**
 * Pages render <SetPageTitle> to drive the header. `kicker` is optional — omitting it leaves the
 * route's default line in place rather than blanking it.
 */
export function SetPageTitle({ title, kicker }: { title: string; kicker?: string }) {
  const ctx = useContext(PageTitleCtx);
  const setMeta = ctx?.setMeta;
  useEffect(() => {
    if (!setMeta) return;
    setMeta({ title, kicker: kicker ?? null });
    return () => setMeta({ title: null, kicker: null });
  }, [setMeta, title, kicker]);
  return null;
}

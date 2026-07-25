'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Ctx = { title: string | null; setTitle: (t: string | null) => void };
const PageTitleCtx = createContext<Ctx | null>(null);

export function TitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return <PageTitleCtx.Provider value={{ title, setTitle }}>{children}</PageTitleCtx.Provider>;
}

export function usePageTitle(): string | null {
  return useContext(PageTitleCtx)?.title ?? null;
}

/** Pages render <SetPageTitle> to drive the header title (used by later reskin slices). */
export function SetPageTitle({ title }: { title: string }) {
  const ctx = useContext(PageTitleCtx);
  useEffect(() => {
    ctx?.setTitle(title);
    return () => ctx?.setTitle(null);
  }, [ctx, title]);
  return null;
}

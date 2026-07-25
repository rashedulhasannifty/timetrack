'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { TitleProvider } from './PageTitleContext';

export function AppShell({
  role,
  name,
  email,
  footer,
  children,
}: {
  role: string;
  name: string;
  email: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const apply = () => {
      const n = window.innerWidth < 900;
      setNarrow(n);
      if (!n) setOpen(false);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  return (
    <TitleProvider>
      <div className="flex min-h-screen">
        <Sidebar narrow={narrow} open={open} onNavigate={() => setOpen(false)} footer={footer} />
        {narrow && open ? (
          <div
            className="fixed inset-0 z-[60] bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            role={role}
            name={name}
            email={email}
            narrow={narrow}
            onToggleSidebar={() => setOpen((v) => !v)}
          />
          <main className="flex-1 p-8">{children}</main>
        </div>
      </div>
    </TitleProvider>
  );
}

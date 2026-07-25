'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';

export function AccountMenu({ name, email }: { name: string; email: string; role: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={name} size={30} />
      </button>
      {open ? (
        <div className="bg-surface-raised border-separator shadow-e2 absolute right-0 top-[38px] z-40 w-[200px] rounded-md border p-2.5">
          <div className="text-label font-semibold">{name}</div>
          <div className="text-caption text-text-secondary">{email}</div>
          <div className="bg-separator -mx-2.5 my-2 h-px" />
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-label text-destructive cursor-pointer py-1.5">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

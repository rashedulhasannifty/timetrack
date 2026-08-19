'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

/**
 * The identity row at the foot of the sidebar: avatar, name, role, and a menu holding the
 * email and sign-out. The role moved here from a header pill — it belongs with the name it
 * describes, and the header is now the page's own title rather than a chrome bar.
 *
 * The popover opens upward: this sits against the bottom edge of the viewport.
 */
export function AccountMenu({ name, email, role }: { name: string; email: string; role: string }) {
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
        className="hover:bg-surface-raised flex w-full items-center gap-2.5 rounded-[11px] px-1.5 py-1.5 text-left transition-colors"
      >
        <Avatar name={name} size={32} />
        <span className="flex min-w-0 flex-col">
          <span className="text-label truncate font-bold">{name}</span>
          <span className="text-micro text-text-secondary truncate">
            {ROLE_LABEL[role] ?? role}
          </span>
        </span>
        <span aria-hidden="true" className="text-neutral ml-auto pr-1">
          ⋯
        </span>
      </button>
      {open ? (
        <div className="bg-surface-raised border-separator shadow-e2 absolute bottom-[46px] left-0 z-40 w-[210px] rounded-[14px] border p-2.5">
          <div className="text-label font-bold">{name}</div>
          <div className="text-caption text-text-secondary truncate">{email}</div>
          <div className="bg-separator -mx-2.5 my-2 h-px" />
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="text-label text-destructive cursor-pointer py-1.5 font-semibold"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

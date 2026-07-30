'use client';

import { useEffect, useRef, useState } from 'react';
import { useWidgetVisibility } from './WidgetVisibilityProvider';

export interface WidgetGroup {
  label: string;
  items: { id: string; label: string }[];
}

/** "⚙ Widgets" button + a right-hand panel of grouped checkboxes bound to the visibility context. */
export function WidgetsDrawer({ groups }: { groups: WidgetGroup[] }) {
  const [open, setOpen] = useState(false);
  const { isOn, toggle } = useWidgetVisibility();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-separator text-text-secondary hover:text-text rounded-full border px-3 py-1.5 text-label"
      >
        ⚙ Widgets
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-40 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Widgets"
        >
          <button
            type="button"
            aria-label="Close"
            className="flex-1 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="bg-surface-raised border-separator flex w-72 flex-col gap-4 overflow-y-auto border-l p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-body font-semibold">Widgets</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-text-secondary text-label"
              >
                Done
              </button>
            </div>
            {groups.map((g) => (
              <fieldset key={g.label} className="flex flex-col gap-2">
                <legend className="text-label text-text-secondary mb-1 font-semibold uppercase">
                  {g.label}
                </legend>
                {g.items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={isOn(it.id)} onChange={() => toggle(it.id)} />
                    {it.label}
                  </label>
                ))}
              </fieldset>
            ))}
            <p className="text-caption text-text-secondary">Remembered on this browser only.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { IconMoon, IconSun } from './icons';

/**
 * Light/dark toggle. The root-layout inline script already set `.dark` before paint;
 * this syncs to that on mount, then flips the class + persists to localStorage['tt-theme'].
 * Class strategy (see globals.css) so the choice wins over the OS setting.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('tt-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode — the class still applies for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light appearance' : 'Switch to dark appearance'}
      className="border-separator bg-surface-raised text-text-secondary hover:text-text shadow-e1 mb-1 grid h-9 w-9 flex-none place-items-center rounded-full border transition-colors"
    >
      {dark ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
    </button>
  );
}

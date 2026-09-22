'use client';

import { useEffect, useState } from 'react';
import { IconRows } from './icons';
import { normalizeDensity, nextDensity, type Density } from '../../lib/density';

/**
 * Compact/comfortable row heights. The root-layout inline script already set data-density
 * before paint; this syncs to that on mount, then flips the attribute and persists the choice
 * — the same shape as ThemeToggle, deliberately.
 */
export function DensityToggle() {
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    setDensity(normalizeDensity(document.documentElement.getAttribute('data-density')));
  }, []);

  function toggle() {
    const next = nextDensity(density);
    setDensity(next);
    document.documentElement.setAttribute('data-density', next);
    try {
      localStorage.setItem('tt-density', next);
    } catch {
      /* private mode — the attribute still applies for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={density === 'compact' ? 'Switch to comfortable rows' : 'Switch to compact rows'}
      className="border-separator bg-surface-raised text-text-secondary hover:text-text mb-1 grid h-9 w-9 flex-none place-items-center rounded-full border transition-colors"
    >
      <IconRows width={16} height={16} />
    </button>
  );
}

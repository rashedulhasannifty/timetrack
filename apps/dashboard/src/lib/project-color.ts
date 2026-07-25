/**
 * Deterministic project → dot color fallback. The palette is the single source in
 * @timetrack/contracts (also the write-enum for the picker). A project with a stored `color`
 * uses it; a null color falls back to this derivation. Presentational; dashboard-only.
 */
import { PROJECT_PALETTE } from '@timetrack/contracts';

export { PROJECT_PALETTE };

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function projectColor(id: string): string {
  const idx = hashString(id) % PROJECT_PALETTE.length;
  // Index is always in range; the `?? [0]` satisfies noUncheckedIndexedAccess.
  return PROJECT_PALETTE[idx] ?? PROJECT_PALETTE[0];
}

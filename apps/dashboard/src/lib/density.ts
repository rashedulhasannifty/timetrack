/** Row-height preference. Persisted in localStorage['tt-density'] and applied as the
 *  [data-density] attribute on <html>, which globals.css keys --pad-y off (tables consume it
 *  for their vertical padding). --row-h is also defined per density there but not yet
 *  consumed by anything. */
export type Density = 'compact' | 'comfortable';

const VALID: readonly Density[] = ['compact', 'comfortable'];

/**
 * Coerce a stored value to a usable density. localStorage is absent in private windows and
 * may hold whatever an older version wrote, so anything unrecognised falls back — writing a
 * bogus value into data-density would match neither CSS block and collapse table padding.
 */
export function normalizeDensity(value: string | null): Density {
  return VALID.includes(value as Density) ? (value as Density) : 'comfortable';
}

export function nextDensity(current: Density): Density {
  return current === 'compact' ? 'comfortable' : 'compact';
}

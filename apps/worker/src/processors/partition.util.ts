/** Pure date math for monthly partition provisioning — unit-tested without a DB. */

export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * How many months past the current one each run keeps provisioned. A run that fails for a few
 * nights in a row (or a month boundary that lands on an outage) must not leave the next month
 * without a partition — ingest then has nowhere to put current data.
 */
export const PROVISION_MONTHS_AHEAD = 3;

/** UTC month starts for the month containing `now` plus the `ahead` months after it. */
export function monthStartsAhead(now: Date, ahead: number): Date[] {
  return Array.from(
    { length: ahead + 1 },
    (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)),
  );
}

export interface MonthPartition {
  suffix: string;
  from: string;
  to: string;
}

export function monthPartition(monthStart: Date): MonthPartition {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth(); // 0-based
  const next = new Date(Date.UTC(year, month + 1, 1));
  return {
    suffix: `${year}_${String(month + 1).padStart(2, '0')}`,
    from: monthStart.toISOString().slice(0, 10),
    to: next.toISOString().slice(0, 10),
  };
}

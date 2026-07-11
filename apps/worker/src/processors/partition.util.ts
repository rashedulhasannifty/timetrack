/** Pure date math for monthly partition provisioning — unit-tested without a DB. */

export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
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

'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface DailyActivityPoint {
  label: string;
  activityPct: number;
}

/**
 * PRD §6.3 — per-day activity %, one bar per UTC day. Discrete daily values from the daily
 * rollup (distinct from the intraday sample line). Fed by a Server Component parent.
 */
export function ActivityDailyChart({ data }: { data: DailyActivityPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="label" fontSize={12} />
          <YAxis domain={[0, 100]} fontSize={12} />
          <Tooltip />
          <Bar dataKey="activityPct" fill="#171717" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

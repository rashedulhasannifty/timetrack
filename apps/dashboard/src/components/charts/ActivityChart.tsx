'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ActivityPoint {
  label: string;
  activityPct: number;
}

/**
 * PRD §7.6 — Recharts for activity/time visualisation. A client component because charts
 * are interactive; feed it data fetched by a Server Component parent.
 */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="label" fontSize={12} />
          <YAxis domain={[0, 100]} fontSize={12} />
          <Tooltip />
          <Line type="monotone" dataKey="activityPct" stroke="#171717" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface HoursTrendPoint {
  label: string;
  hours: number;
}

/** Hours tracked per Dhaka day for one project. One bar per day; no fixed Y domain. */
export function ProjectHoursTrendChart({ data }: { data: HoursTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-text-secondary text-body">No time in this range.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="label" fontSize={12} tick={{ fill: 'var(--color-text-secondary)' }} />
          <YAxis fontSize={12} tick={{ fill: 'var(--color-text-secondary)' }} allowDecimals />
          <Tooltip />
          <Bar dataKey="hours" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

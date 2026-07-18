'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ProjectBar {
  name: string;
  hours: number;
}

/** PRD §6.5 — hours per project across the visible scope. Horizontal bars, neutral palette. */
export function ProjectHoursChart({ data }: { data: ProjectBar[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-500">No project time in this range.</p>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
          <XAxis type="number" fontSize={12} />
          <YAxis type="category" dataKey="name" width={140} fontSize={12} />
          <Tooltip />
          <Bar dataKey="hours" fill="#171717" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import type { CSSProperties } from 'react';
import { Card } from './Card';

/**
 * Placeholder blocks shown while a route resolves.
 *
 * The shimmer reuses the existing `tt-pulse` class rather than adding a second keyframe — the
 * global prefers-reduced-motion block in globals.css already freezes it, so a motion-sensitive
 * viewer gets a static grey block instead of a throbbing one.
 *
 * All three are aria-hidden: a screen reader announcing a dozen blank boxes is worse than
 * silence, and the route's own heading is what says the page is coming.
 */
export function Skeleton({
  width,
  height = 12,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  const style: CSSProperties = { height, ...(width !== undefined ? { width } : {}) };
  return (
    <span
      aria-hidden="true"
      className={`bg-muted-bg tt-pulse block rounded-sm ${width === undefined ? 'w-full' : ''} ${className}`.trim()}
      style={style}
    />
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <table aria-hidden="true" className="w-full border-collapse">
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} className="border-separator border-t">
            {Array.from({ length: columns }, (_, c) => (
              <td key={c} className="px-[26px] py-[var(--pad-y)]">
                {/* The first column is the wide one in every table here (a person or a
                    project name), so the sketch matches the shape that will replace it. */}
                <Skeleton width={c === 0 ? 160 : 72} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The route-level fallback: a heading-sized bar over a card holding a table sketch. This is
 *  what makes TableSkeleton a consumed export rather than dead code. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-[22px]">
      <Skeleton width={220} height={26} />
      <Card padding="none" className="overflow-hidden">
        <TableSkeleton />
      </Card>
    </div>
  );
}

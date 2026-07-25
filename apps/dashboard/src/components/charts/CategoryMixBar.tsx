export interface CategoryMixBarProps {
  productive: number;
  neutral: number;
  unproductive: number;
}

/**
 * A stacked horizontal bar showing the distribution of productive, neutral, and unproductive time,
 * with a legend below showing swatches and percentages. Static, server-renderable component.
 */
export function CategoryMixBar({ productive, neutral, unproductive }: CategoryMixBarProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex h-[10px] overflow-hidden rounded-[3px]">
        <div
          style={{
            width: `${productive}%`,
            backgroundColor: 'var(--tt-category-productive)',
          }}
        />
        <div
          style={{
            width: `${neutral}%`,
            backgroundColor: 'var(--tt-category-neutral)',
          }}
        />
        <div
          style={{
            width: `${unproductive}%`,
            backgroundColor: 'var(--tt-category-unproductive)',
          }}
        />
      </div>
      <div className="flex flex-wrap gap-3.5 text-caption text-text-secondary tt-numeric">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-[8px] w-[8px] flex-none rounded-[2px]"
            style={{
              backgroundColor: 'var(--tt-category-productive)',
            }}
          />
          Productive {productive}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-[8px] w-[8px] flex-none rounded-[2px]"
            style={{
              backgroundColor: 'var(--tt-category-neutral)',
            }}
          />
          Neutral {neutral}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-[8px] w-[8px] flex-none rounded-[2px]"
            style={{
              backgroundColor: 'var(--tt-category-unproductive)',
            }}
          />
          Unproductive {unproductive}%
        </span>
      </div>
    </div>
  );
}

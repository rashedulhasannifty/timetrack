import type { ReactNode } from 'react';

/**
 * The calm "nothing to show" panel. Presentational and function-prop-free, so it can be
 * rendered from a Server Component as well as from inside `DataTable`.
 */
export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  /** One sentence on why it is empty and what would fill it. */
  body?: string;
  /** Decorative glyph — hidden from assistive tech; the title carries the meaning. */
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-[26px] py-12 text-center">
      {icon ? (
        <span aria-hidden="true" className="text-neutral mb-1 inline-flex">
          {icon}
        </span>
      ) : null}
      <span className="text-h3 font-bold">{title}</span>
      {body ? <p className="text-text-secondary text-label max-w-[46ch]">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

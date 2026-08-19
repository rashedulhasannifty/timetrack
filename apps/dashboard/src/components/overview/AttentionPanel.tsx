import Link from 'next/link';
import type { AttentionItem } from '../../lib/overview-view';

const TONE_COLOR: Record<AttentionItem['tone'], string> = {
  bad: 'var(--tt-destructive)',
  warn: 'var(--tt-category-unproductive)',
  neutral: 'var(--tt-neutral)',
};

/** The short list of things on the overview that someone should act on. */
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-text-secondary text-caption py-3">
        Nothing needs attention — everyone tracked today, no timesheets are waiting, and every top
        app is rated.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((item) => (
        <li key={item.id} className="border-separator border-t">
          <Link
            href={item.href}
            className="text-text hover:bg-surface -mx-2 flex items-start gap-[11px] rounded-[11px] px-2 py-3 transition-colors"
          >
            <span
              aria-hidden="true"
              className="mt-[7px] h-[7px] w-[7px] flex-none rounded-full"
              style={{ background: TONE_COLOR[item.tone] }}
            />
            <span className="flex flex-1 flex-col gap-px">
              <span className="text-label font-semibold leading-snug">{item.title}</span>
              <span className="text-text-secondary text-caption">{item.detail}</span>
            </span>
            <span className="text-accent text-caption whitespace-nowrap font-bold">
              {item.action} →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

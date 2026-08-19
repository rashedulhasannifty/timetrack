import Link from 'next/link';

export type TabItem = { href: string; label: string };

/**
 * Segmented control: a recessed track with the active tab lifted out of it as a raised pill.
 * Link-based, so the URL stays the state and every panel behind it can stay a Server Component.
 *
 * `tone='raised'` is the standalone strip that sits on the page background; `tone='sunken'` is
 * the variant used inside a Card, where the track has to be darker than the surface it sits on.
 */
export function Tabs({
  items,
  activeHref,
  tone = 'raised',
  label,
}: {
  items: TabItem[];
  activeHref: string;
  tone?: 'raised' | 'sunken';
  label: string;
}) {
  const track =
    tone === 'raised'
      ? 'bg-surface-raised border-separator border rounded-lg p-[3px]'
      : 'bg-surface rounded-lg p-[3px]';
  return (
    <nav aria-label={label} className={`inline-flex gap-0.5 self-start ${track}`}>
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`text-caption rounded-sm px-[11px] py-[5px] font-medium transition-colors ${
              active
                ? 'bg-surface-raised text-text shadow-e1'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

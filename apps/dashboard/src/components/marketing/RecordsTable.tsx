/**
 * The records / never-records disclosure, shown on both public pages.
 *
 * Deliberately a fixed list rather than a fetch of the live policy: this renders with no
 * session, so it cannot know the viewer's org. The authoritative, policy-derived version is
 * the one the client shows at first launch (Policy/AckView) — both pages say so in prose.
 * The "never" column is the fixed guarantee set from CLAUDE.md §1 and holds regardless of
 * settings; the two conditional "records" lines are marked as such.
 */

const RECORDS = [
  'Time entries and durations',
  'Active app and website category',
  'An activity level, as a percentage',
  'Periodic screenshots, if enabled',
  'Active window titles, if enabled',
] as const;

const NEVER = [
  'Keystrokes — what you type',
  'Message or document content',
  'Passwords',
  'Webcam, microphone, or clipboard',
  'Location or GPS',
] as const;

function Column({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: 'good' | 'destructive';
}) {
  const accent = tone === 'good' ? 'text-good' : 'text-destructive';
  return (
    <div className="border-separator bg-surface-raised rounded-lg border p-5">
      <p className={`text-caption mb-3 font-mono tracking-[0.1em] uppercase ${accent}`}>{title}</p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="text-label flex gap-2.5 leading-snug">
            <span className={`font-mono ${accent}`} aria-hidden="true">
              {tone === 'good' ? '+' : '–'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecordsTable() {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <Column title="Records" items={RECORDS} tone="good" />
      <Column title="Never records" items={NEVER} tone="destructive" />
    </div>
  );
}

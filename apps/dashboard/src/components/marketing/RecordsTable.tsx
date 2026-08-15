/**
 * The records / never-records disclosure.
 *
 * Deliberately a fixed list rather than a fetch of the live policy: this renders with no
 * session, so it cannot know the viewer's org. The authoritative, policy-derived version is
 * the one the client shows at first launch (Policy/AckView) — both pages say so in prose.
 * The "never" column is the fixed guarantee set from CLAUDE.md §1 and holds regardless of
 * settings; the two conditional "records" lines are marked as such.
 *
 * `stacked` is the home page hero panel — the whole argument for this product is what it
 * refuses to do, so that belongs above the fold rather than halfway down the page.
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

function List({ items, tone }: { items: readonly string[]; tone: 'good' | 'destructive' }) {
  const accent = tone === 'good' ? 'text-good' : 'text-destructive';
  return (
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
  );
}

function Heading({ children, tone }: { children: string; tone: 'good' | 'destructive' }) {
  const accent = tone === 'good' ? 'text-good' : 'text-destructive';
  return (
    <p className={`text-caption mb-3 font-mono tracking-[0.1em] uppercase ${accent}`}>{children}</p>
  );
}

/** Hero panel: both halves in one plate, divided by a rule. */
export function LimitsLedger() {
  return (
    <div className="border-separator bg-surface-raised divide-separator divide-y overflow-hidden rounded-xl border">
      <div className="p-6">
        <Heading tone="good">Records</Heading>
        <List items={RECORDS} tone="good" />
      </div>
      <div className="p-6">
        <Heading tone="destructive">Never records</Heading>
        <List items={NEVER} tone="destructive" />
      </div>
    </div>
  );
}

/** Two side-by-side cards, for in-page use. */
export function RecordsTable() {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <div className="border-separator bg-surface-raised rounded-lg border p-5">
        <Heading tone="good">Records</Heading>
        <List items={RECORDS} tone="good" />
      </div>
      <div className="border-separator bg-surface-raised rounded-lg border p-5">
        <Heading tone="destructive">Never records</Heading>
        <List items={NEVER} tone="destructive" />
      </div>
    </div>
  );
}

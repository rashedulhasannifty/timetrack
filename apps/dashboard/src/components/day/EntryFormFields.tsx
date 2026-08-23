import type { Project } from '@timetrack/contracts';

/**
 * The four inputs an entry is made of, shared by the add form and the per-row edit form so the
 * two can never drift into accepting different things.
 *
 * `day`/`start`/`end` are wall-clock in APP_TIMEZONE; the Server Action converts them through
 * `parseEntryTimes`. Native date/time inputs rather than a picker component: they are
 * keyboard-accessible, localised by the browser, and need no JavaScript of ours.
 */
export function EntryFormFields({
  projects,
  defaults,
}: {
  projects: Project[];
  defaults: { day: string; start: string; end: string; projectId: string | null; note: string };
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-caption text-text-secondary">Date</span>
          <input
            name="day"
            type="date"
            required
            defaultValue={defaults.day}
            className="border-separator bg-surface text-text rounded-[10px] border px-2.5 py-1.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">From</span>
          <input
            name="start"
            type="time"
            required
            defaultValue={defaults.start}
            className="border-separator bg-surface text-text tt-numeric rounded-[10px] border px-2.5 py-1.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">To</span>
          <input
            name="end"
            type="time"
            required
            defaultValue={defaults.end}
            className="border-separator bg-surface text-text tt-numeric rounded-[10px] border px-2.5 py-1.5 text-[13px]"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-text-secondary">Project</span>
        <select
          name="projectId"
          defaultValue={defaults.projectId ?? ''}
          className="border-separator bg-surface text-text rounded-[10px] border px-2.5 py-1.5 text-[13px]"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-text-secondary">Note</span>
        <input
          name="note"
          type="text"
          maxLength={2000}
          defaultValue={defaults.note}
          placeholder="What were you working on?"
          className="border-separator bg-surface text-text rounded-[10px] border px-2.5 py-1.5 text-[13px]"
        />
      </label>
    </>
  );
}

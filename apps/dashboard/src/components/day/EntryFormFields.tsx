import type { Project } from '@timetrack/contracts';
import {
  assignmentGroups,
  encodeAssignment,
  recentOptions,
  type Assignment,
} from '../../lib/entry-form';
import { AssignmentPicker } from './AssignmentPicker';

/**
 * The inputs an entry is made of (date, times, one searchable "Assign to" picker, note), shared by the add form and the per-row edit form so the
 * two can never drift into accepting different things.
 *
 * `day`/`start`/`end` are wall-clock in APP_TIMEZONE; the Server Action converts them through
 * `parseEntryTimes`. Native date/time inputs rather than a picker component: they are
 * keyboard-accessible, localised by the browser, and need no JavaScript of ours.
 */
export function EntryFormFields({
  projects,
  recent,
  defaults,
}: {
  projects: Project[];
  /** What this day's entries were assigned to, most recent first — offered at the top. */
  recent: Assignment[];
  defaults: {
    day: string;
    start: string;
    end: string;
    assignment: Assignment | null;
    note: string;
  };
}) {
  const groups = assignmentGroups(projects, defaults.assignment);
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
            className="border-separator bg-surface text-text rounded-md border px-2.5 py-1.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">From</span>
          <input
            name="start"
            type="time"
            required
            defaultValue={defaults.start}
            className="border-separator bg-surface text-text tt-numeric rounded-md border px-2.5 py-1.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">To</span>
          <input
            name="end"
            type="time"
            required
            defaultValue={defaults.end}
            className="border-separator bg-surface text-text tt-numeric rounded-md border px-2.5 py-1.5 text-[13px]"
          />
        </label>
      </div>
      <AssignmentPicker
        groups={groups}
        recent={recentOptions(groups, recent)}
        defaultValue={defaults.assignment ? encodeAssignment(defaults.assignment) : ''}
      />
      <label className="flex flex-col gap-1">
        <span className="text-caption text-text-secondary">Note</span>
        <input
          name="note"
          type="text"
          maxLength={2000}
          defaultValue={defaults.note}
          placeholder="What were you working on?"
          className="border-separator bg-surface text-text rounded-md border px-2.5 py-1.5 text-[13px]"
        />
      </label>
    </>
  );
}

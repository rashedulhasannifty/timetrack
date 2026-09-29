import { dayStartInstant, isValidDay } from '@timetrack/contracts';
import type { Project } from '@timetrack/contracts';

/**
 * Turning "24 Aug, 09:00 to 17:30" into the pair of instants the API wants.
 *
 * Pure and separated from the Server Action so the rules below are actually testable — the
 * dashboard's vitest runs in a node environment, so a transform like this is the seam worth
 * covering, not the form component around it.
 */

export type ParsedEntryTimes =
  { ok: true; startTime: string; endTime: string } | { ok: false; message: string };

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A span longer than this is refused as a typo rather than filed.
 *
 * It exists because of the midnight rule below: once an end time at or before the start is
 * read as "the next day", a transposed pair (start 14:00, end 09:00) silently becomes a
 * 19-hour entry instead of an obvious mistake. Sixteen hours is past any real shift and well
 * short of what a typo produces.
 */
const MAX_SPAN_HOURS = 16;

/** Minutes past midnight for an 'HH:MM' clock reading, or null if it is not one. */
function minutesOf(clock: string): number | null {
  const m = CLOCK.exec(clock);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * `day` is a calendar day in APP_TIMEZONE and `start`/`end` are wall-clock readings in it, so
 * both instants are built from `dayStartInstant` rather than from the browser's clock — a
 * person filing time is describing the office day, not their laptop's time zone.
 *
 * An `end` at or before `start` means the span crossed midnight (a night shift, or the
 * early-morning hours this product's own week boundary is anchored around), so it lands on
 * the following day rather than being rejected.
 */
export function parseEntryTimes(day: string, start: string, end: string): ParsedEntryTimes {
  if (!isValidDay(day)) return { ok: false, message: 'Pick a date.' };
  const startMin = minutesOf(start);
  const endMin = minutesOf(end);
  if (startMin === null || endMin === null) {
    return { ok: false, message: 'Enter times as HH:MM.' };
  }

  const dayStart = dayStartInstant(day).getTime();
  const startMs = dayStart + startMin * 60_000;
  const endMs = dayStart + (endMin > startMin ? endMin : endMin + 24 * 60) * 60_000;

  if (endMs === startMs) return { ok: false, message: 'That entry is zero minutes long.' };
  if (endMs - startMs > MAX_SPAN_HOURS * 3_600_000) {
    return {
      ok: false,
      message: `That is longer than ${MAX_SPAN_HOURS} hours — check the times.`,
    };
  }

  return {
    ok: true,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
  };
}

/**
 * A required text field, as a string.
 *
 * `FormData.get` is typed `string | File | null`, so stringifying it directly would turn a
 * field someone posted as a file into the literal "[object File]" and feed that to the
 * parsers below. Anything that is not a string reads as absent and fails validation, which is
 * the correct outcome for a form that was not the one we rendered.
 */
export function textField(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' ? raw : '';
}

/** An empty or whitespace-only optional field is absent, not an empty string. */
export function optionalText(raw: FormDataEntryValue | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A `<select>` whose empty option means "no project". */
export function optionalId(raw: FormDataEntryValue | null): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * An entry's assignment, carried by ONE grouped <select> as `projectId|subprojectId|taskId` so
 * the form needs no client-side cascade. '' means "No project".
 */
export type Assignment = {
  projectId: string | null;
  subprojectId: string | null;
  taskId: string | null;
};
export type AssignmentGroup = { label: string; options: { value: string; label: string }[] };

const NONE: Assignment = { projectId: null, subprojectId: null, taskId: null };
const ID = /^[0-9a-f-]{36}$/i;

export function encodeAssignment(a: Assignment): string {
  if (a.projectId === null) return '';
  return `${a.projectId}|${a.subprojectId ?? ''}|${a.taskId ?? ''}`;
}

/** null = malformed (a tampered or stale form); the caller refuses rather than guessing. */
export function parseAssignment(raw: FormDataEntryValue | null): Assignment | null {
  if (raw === null || raw === '') return NONE;
  if (typeof raw !== 'string') return null;
  const parts = raw.split('|');
  if (parts.length !== 3) return null;
  const [projectId, subprojectId, taskId] = parts as [string, string, string];
  if (!ID.test(projectId)) return null;
  if (subprojectId !== '' && !ID.test(subprojectId)) return null;
  if (taskId !== '' && !ID.test(taskId)) return null;
  return { projectId, subprojectId: subprojectId || null, taskId: taskId || null };
}

/**
 * The select's options: per project, each subproject (default first, as the API orders them)
 * followed by its tasks as `Subproject › Task`. Archived projects/subprojects are not offered —
 * EXCEPT the entry's current assignment, which is always present so that saving an unrelated
 * change (a time, a note) can never silently move the entry.
 */
export function assignmentGroups(
  projects: Project[],
  current: Assignment | null,
): AssignmentGroup[] {
  const currentValue = current && current.projectId !== null ? encodeAssignment(current) : null;
  let currentOffered = false;

  const groups: AssignmentGroup[] = [];
  for (const p of projects) {
    const isCurrentProject = current?.projectId === p.id;
    if (p.archived && !isCurrentProject) continue;
    const options: AssignmentGroup['options'] = [];
    for (const s of p.subprojects ?? []) {
      if (s.archived && current?.subprojectId !== s.id) continue;
      options.push({
        value: encodeAssignment({ projectId: p.id, subprojectId: s.id, taskId: null }),
        label: s.name,
      });
      for (const t of (p.tasks ?? []).filter((t) => t.subprojectId === s.id)) {
        options.push({
          value: encodeAssignment({ projectId: p.id, subprojectId: s.id, taskId: t.id }),
          label: `${s.name} › ${t.name}`,
        });
      }
    }
    if (currentValue && options.some((o) => o.value === currentValue)) currentOffered = true;
    if (isCurrentProject && currentValue && !currentOffered) {
      options.push({ value: currentValue, label: 'Current assignment' });
      currentOffered = true;
    }
    if (options.length > 0) groups.push({ label: p.name, options });
  }
  if (currentValue && !currentOffered) {
    groups.push({
      label: 'Current',
      options: [{ value: currentValue, label: 'Current assignment' }],
    });
  }
  return groups;
}

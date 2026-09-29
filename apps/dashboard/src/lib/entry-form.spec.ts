import { describe, it, expect } from 'vitest';
import {
  parseEntryTimes,
  optionalText,
  optionalId,
  textField,
  assignmentGroups,
  encodeAssignment,
  parseAssignment,
} from './entry-form';
import type { Project } from '@timetrack/contracts';

describe('parseEntryTimes', () => {
  it('builds both instants from the APP_TIMEZONE day, not the runner clock', () => {
    // Dhaka is UTC+6, so 09:00 on 2026-08-24 is 03:00Z the same day.
    const r = parseEntryTimes('2026-08-24', '09:00', '17:30');
    expect(r).toEqual({
      ok: true,
      startTime: '2026-08-24T03:00:00.000Z',
      endTime: '2026-08-24T11:30:00.000Z',
    });
  });

  it('reads an end at or before the start as crossing midnight', () => {
    // A night shift, and the early-morning hours the approval week is anchored around.
    const r = parseEntryTimes('2026-08-24', '22:00', '02:00');
    expect(r).toEqual({
      ok: true,
      startTime: '2026-08-24T16:00:00.000Z',
      endTime: '2026-08-24T20:00:00.000Z',
    });
  });

  it('refuses a transposed pair as a typo rather than filing 19 hours', () => {
    const r = parseEntryTimes('2026-08-24', '14:00', '09:00');
    // Narrowed rather than matched loosely: `expect.stringContaining` is typed `any`, and the
    // union makes the real assertion available directly.
    if (r.ok) throw new Error('expected the transposed pair to be refused');
    expect(r.message).toContain('16 hours');
  });

  it('refuses a zero-length span', () => {
    expect(parseEntryTimes('2026-08-24', '09:00', '09:00')).toMatchObject({ ok: false });
  });

  it('refuses a bad day or a bad clock reading', () => {
    expect(parseEntryTimes('2026-02-30', '09:00', '10:00')).toMatchObject({ ok: false });
    expect(parseEntryTimes('2026-08-24', '9:00', '10:00')).toMatchObject({ ok: false });
    expect(parseEntryTimes('2026-08-24', '24:00', '10:00')).toMatchObject({ ok: false });
    expect(parseEntryTimes('2026-08-24', '09:60', '10:00')).toMatchObject({ ok: false });
  });

  it('accepts the edges of the clock', () => {
    expect(parseEntryTimes('2026-08-24', '00:00', '08:00').ok).toBe(true);
    expect(parseEntryTimes('2026-08-24', '15:59', '23:59').ok).toBe(true);
    // ...but a span covering nearly the whole clock is still a typo, not a shift.
    expect(parseEntryTimes('2026-08-24', '00:00', '23:59').ok).toBe(false);
  });
});

describe('optional field readers', () => {
  it('treats blank and whitespace as absent', () => {
    expect(optionalText('  ')).toBeUndefined();
    expect(optionalText('')).toBeUndefined();
    expect(optionalText(null)).toBeUndefined();
    expect(optionalText('  a note ')).toBe('a note');
  });

  it('reads a non-string field as absent rather than "[object File]"', () => {
    expect(textField(new File([], 'x.txt'))).toBe('');
    expect(textField(null)).toBe('');
    expect(textField('2026-08-24')).toBe('2026-08-24');
  });

  it('maps an unselected project to null, not an empty string', () => {
    expect(optionalId('')).toBeNull();
    expect(optionalId(null)).toBeNull();
    expect(optionalId('p1')).toBe('p1');
  });
});

const P = '018f9c1e-0000-7000-8000-000000000001';
const G = '018f9c1e-0000-7000-8000-000000000002';
const C = '018f9c1e-0000-7000-8000-000000000003';
const T = '018f9c1e-0000-7000-8000-000000000004';

const project = (over: Record<string, unknown> = {}) =>
  ({
    id: P,
    teamId: P,
    name: 'Website',
    color: null,
    archived: false,
    subprojects: [
      { id: G, projectId: P, name: 'General', archived: false, isDefault: true },
      { id: C, projectId: P, name: 'Checkout', archived: false, isDefault: false },
    ],
    tasks: [{ id: T, projectId: P, subprojectId: C, name: 'Pay form', archived: false }],
    ...over,
  }) as unknown as Project;

describe('assignment encoding', () => {
  it('round-trips a full and a partial assignment', () => {
    for (const a of [
      { projectId: P, subprojectId: C, taskId: T },
      { projectId: P, subprojectId: G, taskId: null },
      { projectId: null, subprojectId: null, taskId: null },
    ]) {
      expect(parseAssignment(encodeAssignment(a))).toEqual(a);
    }
  });

  it('rejects malformed values', () => {
    expect(parseAssignment('nope')).toBeNull();
    expect(parseAssignment(`${P}|x|`)).toBeNull();
    expect(parseAssignment(null)).toEqual({ projectId: null, subprojectId: null, taskId: null });
  });
});

describe('assignmentGroups', () => {
  it('one group per project; a subproject option then its tasks, default first', () => {
    expect(assignmentGroups([project()], null)).toEqual([
      {
        label: 'Website',
        options: [
          { value: `${P}|${G}|`, label: 'General' },
          { value: `${P}|${C}|`, label: 'Checkout' },
          { value: `${P}|${C}|${T}`, label: 'Checkout › Pay form' },
        ],
      },
    ]);
  });

  it('omits archived projects and subprojects…', () => {
    const p = project({
      subprojects: [
        { id: G, projectId: P, name: 'General', archived: false, isDefault: true },
        { id: C, projectId: P, name: 'Checkout', archived: true, isDefault: false },
      ],
    });
    expect(assignmentGroups([p], null)[0]?.options.map((o) => o.label)).toEqual(['General']);
    expect(assignmentGroups([project({ archived: true })], null)).toEqual([]);
  });

  it('…but keeps the CURRENT assignment so saving an edit never silently reassigns it', () => {
    const p = project({
      subprojects: [
        { id: G, projectId: P, name: 'General', archived: false, isDefault: true },
        { id: C, projectId: P, name: 'Checkout', archived: true, isDefault: false },
      ],
      tasks: [],
    });
    const current = { projectId: P, subprojectId: C, taskId: T };
    const values = assignmentGroups([p], current).flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain(encodeAssignment(current));
  });

  it('keeps a current assignment whose project is not in the list', () => {
    const current = { projectId: T, subprojectId: null, taskId: null };
    const groups = assignmentGroups([], current);
    expect(groups).toEqual([
      {
        label: 'Current',
        options: [{ value: encodeAssignment(current), label: 'Current assignment' }],
      },
    ]);
  });
});

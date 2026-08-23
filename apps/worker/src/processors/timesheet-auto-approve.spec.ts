import { describe, it, expect } from 'vitest';
import { skipReasonFor } from './timesheet-auto-approve.js';

const settings = { timesheetReminderHours: 20, autoApproveMaxHours: 60 };

describe('skipReasonFor', () => {
  it('approves an ordinary week', () => {
    expect(skipReasonFor(0, 38, settings)).toBeNull();
  });

  it('escalates a week with an unresolved idle window', () => {
    // Nobody has said whether that time counts, so the total does not mean anything yet —
    // and it outranks the hour guardrails, which are judged on a number that may still move.
    expect(skipReasonFor(1, 38, settings)).toBe('unresolved-idle');
    expect(skipReasonFor(1, 0, settings)).toBe('unresolved-idle');
  });

  it('escalates a suspiciously empty week', () => {
    expect(skipReasonFor(0, 19.9, settings)).toBe('below-floor');
    expect(skipReasonFor(0, 20, settings)).toBeNull(); // exactly at the floor is fine
  });

  it('escalates an implausibly full week (a stranded timer)', () => {
    expect(skipReasonFor(0, 60.1, settings)).toBe('above-ceiling');
    expect(skipReasonFor(0, 60, settings)).toBeNull(); // exactly at the ceiling is fine
  });

  it('treats a zero floor as disabled, exactly as the reminder email does', () => {
    const noFloor = { timesheetReminderHours: 0, autoApproveMaxHours: 60 };
    expect(skipReasonFor(0, 0, noFloor)).toBeNull();
  });
});

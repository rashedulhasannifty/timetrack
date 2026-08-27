import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import {
  reconstructStretches,
  trimRunawayEntries,
} from '../src/processors/runaway-entry-trim.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * This script REWRITES recorded hours, so both halves are pinned: the runaway span it must
 * repair, and everything it must refuse to touch.
 *
 * All sample timestamps sit in 2026-08 — activity_samples is monthly-partitioned and the
 * migrations seed 2026-07..2026-12.
 */
describe('reconstructStretches', () => {
  const t = (iso: string) => new Date(iso);
  const span = { start: t('2026-08-25T08:00:00Z'), end: t('2026-08-27T07:50:00Z') };
  const FIVE_MIN = 300;

  /**
   * The client samples once a MINUTE while a span is open, so real evidence is a dense run, not
   * occasional pings. Fixtures that ping every half hour would read as a series of idle gaps —
   * correctly, but they would not be testing the case anyone actually has.
   */
  function everyMinute(fromIso: string, minutes: number): Date[] {
    const from = t(fromIso).getTime();
    return Array.from({ length: minutes }, (_, i) => new Date(from + i * 60_000));
  }

  // The shape that caused this: a Mac asleep between two real working stretches leaves NO rows
  // at all, because no timer fires while it sleeps. Reading `activityPct` alone would see one
  // continuous span and change nothing.
  it('splits a span around a hole in the samples, keeping the work on both sides', () => {
    const active = [
      ...everyMinute('2026-08-25T08:00:00Z', 61), // an hour of work, then the Mac sleeps ~46h
      ...everyMinute('2026-08-27T07:00:00Z', 31), // and they are back the morning after next
    ];
    const out = reconstructStretches(span, active, FIVE_MIN);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ start: span.start, end: t('2026-08-25T09:05:00Z') });
    expect(out[1]).toEqual({ start: t('2026-08-27T07:00:00Z'), end: t('2026-08-27T07:35:00Z') });
  });

  // The other shape: awake but untouched, which arrives as a run of activityPct == 0 rows. The
  // caller filters those out, so it reaches here as the same kind of gap.
  it('treats a run of zero-activity samples as the same gap', () => {
    const out = reconstructStretches(
      { start: t('2026-08-25T08:00:00Z'), end: t('2026-08-25T12:00:00Z') },
      everyMinute('2026-08-25T08:00:00Z', 31), // worked half an hour, then sat untouched till noon
      FIVE_MIN,
    );
    expect(out).toEqual([{ start: t('2026-08-25T08:00:00Z'), end: t('2026-08-25T08:35:00Z') }]);
  });

  // Starting the timer is a deliberate act, so it counts as evidence — the same threshold the
  // live client credits before it times out.
  it('credits the threshold to someone who started and immediately walked away', () => {
    const out = reconstructStretches(
      { start: t('2026-08-25T08:00:00Z'), end: t('2026-08-26T08:00:00Z') },
      [],
      FIVE_MIN,
    );
    expect(out).toEqual([{ start: t('2026-08-25T08:00:00Z'), end: t('2026-08-25T08:05:00Z') }]);
  });

  // A genuine long shift with short breaks must survive intact — this is the case that makes a
  // blunt "cut at the first gap" rule unacceptable.
  it('leaves a continuously active span alone', () => {
    const start = t('2026-08-25T08:00:00Z');
    const active = Array.from({ length: 60 }, (_, i) => new Date(start.getTime() + i * 60_000));
    const out = reconstructStretches({ start, end: t('2026-08-25T09:00:00Z') }, active, FIVE_MIN);
    expect(out).toEqual([{ start, end: t('2026-08-25T09:00:00Z') }]);
  });

  it('never extends a stretch past the span it came from', () => {
    const out = reconstructStretches(
      { start: t('2026-08-25T08:00:00Z'), end: t('2026-08-25T08:10:00Z') },
      everyMinute('2026-08-25T08:00:00Z', 10),
      FIVE_MIN,
    );
    // The last evidence is at 08:09 and the threshold would carry it to 08:14 — capped at the
    // span's own end, never past it.
    expect(out).toEqual([{ start: t('2026-08-25T08:00:00Z'), end: t('2026-08-25T08:10:00Z') }]);
  });
});

describe.runIf(RUN_E2E)('trim-runaway-entries — real Postgres', () => {
  let env: WorkerTestEnv;
  const NOW = new Date('2026-08-28T06:00:00.000Z');

  beforeAll(async () => {
    env = await startWorkerEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  afterEach(async () => {
    await env.prisma.auditLog.deleteMany({});
    await env.prisma.timeEntry.deleteMany({});
    await env.prisma.activitySample.deleteMany({});
    await env.prisma.user.deleteMany({});
    await env.prisma.team.deleteMany({});
  });

  async function seedUser(email = 'u1@example.com') {
    const team = await env.prisma.team.create({
      data: { name: 'Eng', settings: { idleThresholdMinutes: 5 } },
      select: { id: true },
    });
    return env.prisma.user.create({
      data: { email, name: 'U One', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
  }

  /** A dense per-minute run, the cadence the client actually writes while a span is open. */
  async function seedMinuteSamples(userId: string, fromIso: string, minutes: number) {
    const from = new Date(fromIso).getTime();
    await env.prisma.activitySample.createMany({
      data: Array.from({ length: minutes }, (_, i) => ({
        userId,
        timestamp: new Date(from + i * 60_000),
        appName: 'Code',
        activityPct: 40,
        category: 'PRODUCTIVE' as const,
      })),
    });
  }

  const RUNAWAY = '019797a0-0000-7000-8000-0000000000e1';

  async function seedRunaway(userId: string) {
    await env.prisma.timeEntry.create({
      data: {
        id: RUNAWAY,
        userId,
        source: 'MANUAL',
        startTime: new Date('2026-08-25T08:00:00Z'),
        endTime: new Date('2026-08-27T07:50:00Z'), // ~47h50m
      },
    });
    // Real work on 25 Aug, the Mac asleep through 26 Aug, real work again on 27 Aug.
    await seedMinuteSamples(userId, '2026-08-25T08:00:00Z', 61);
    await seedMinuteSamples(userId, '2026-08-27T07:00:00Z', 31);
  }

  it('reports without writing on a dry run', async () => {
    const user = await seedUser();
    await seedRunaway(user.id);

    const report = await trimRunawayEntries(env.prisma, { minHours: 12, apply: false, now: NOW });
    expect(report.applied).toBe(false);
    expect(report.repaired).toBe(1);
    expect(report.outcomes[0]?.stretches).toHaveLength(2);

    const row = await env.prisma.timeEntry.findUniqueOrThrow({ where: { id: RUNAWAY } });
    expect(row.endTime).toEqual(new Date('2026-08-27T07:50:00Z'));
    expect(await env.prisma.timeEntry.count()).toBe(1);
    expect(await env.prisma.auditLog.count()).toBe(0);
  });

  it('splits the span into the stretches the samples support, keeping the far side', async () => {
    const user = await seedUser();
    await seedRunaway(user.id);

    await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });

    const rows = await env.prisma.timeEntry.findMany({ orderBy: { startTime: 'asc' } });
    expect(rows).toHaveLength(2);
    // The original row keeps its id — it is the client's idempotency key, so reusing it means a
    // replayed upload cannot resurrect the runaway span.
    expect(rows[0]?.id).toBe(RUNAWAY);
    expect(rows[0]?.endTime).toEqual(new Date('2026-08-25T09:05:00Z'));
    expect(rows[1]?.startTime).toEqual(new Date('2026-08-27T07:00:00Z'));
    expect(rows[1]?.endTime).toEqual(new Date('2026-08-27T07:35:00Z'));
    // 27 Aug's real work survives — truncating at the first gap would have deleted it.
    expect(rows[1]?.source).toBe('MANUAL');
  });

  it('snapshots the original span into an audit row', async () => {
    const user = await seedUser();
    await seedRunaway(user.id);

    await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });

    const audit = await env.prisma.auditLog.findFirstOrThrow({ where: { targetId: RUNAWAY } });
    expect(audit.action).toBe('time_entry.trim_runaway');
    const diff = audit.diff as { before: { endTime: string }; after: unknown[]; addedEntryIds: string[] };
    expect(diff.before.endTime).toBe('2026-08-27T07:50:00.000Z');
    expect(diff.after).toHaveLength(2);
    expect(diff.addedEntryIds).toHaveLength(1);
  });

  // No samples means capture was not running, so there is no evidence of when this person
  // stopped. Inventing one would rewrite their hours on a guess.
  it('refuses to touch a span with no capture evidence', async () => {
    const user = await seedUser();
    await env.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000000e2',
        userId: user.id,
        source: 'MANUAL',
        startTime: new Date('2026-08-25T08:00:00Z'),
        endTime: new Date('2026-08-26T08:00:00Z'),
      },
    });

    const report = await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });
    expect(report.outcomes[0]?.skipped).toBe('no-capture-evidence');
    expect(report.repaired).toBe(0);
    expect(await env.prisma.auditLog.count()).toBe(0);
  });

  it('leaves a shift shorter than the threshold out of the candidate set entirely', async () => {
    const user = await seedUser();
    await env.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000000e3',
        userId: user.id,
        source: 'MANUAL',
        startTime: new Date('2026-08-25T08:00:00Z'),
        endTime: new Date('2026-08-25T16:00:00Z'), // 8h
      },
    });
    const report = await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });
    expect(report.candidates).toBe(0);
  });

  it('is idempotent — a repaired span is reported as already bounded', async () => {
    const user = await seedUser();
    await seedRunaway(user.id);

    await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });
    const second = await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });

    expect(second.repaired).toBe(0);
    expect(await env.prisma.timeEntry.count()).toBe(2);
    expect(await env.prisma.auditLog.count()).toBe(1);
  });
});

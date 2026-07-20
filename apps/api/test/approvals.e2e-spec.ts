import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalsRepository } from '../src/modules/approvals/approvals.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';
const P_START = new Date('2026-06-29T00:00:00.000Z'); // Monday
const P_END = new Date('2026-07-06T00:00:00.000Z');

describe.runIf(RUN_E2E)('approvals repository (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const repo = () => new ApprovalsRepository(db.prisma as unknown as PrismaService);
  const team = () =>
    db.prisma.team.create({ data: { name: 'Eng', settings: {} }, select: { id: true } });
  const user = (teamId: string, name: string, email: string) =>
    db.prisma.user.create({
      data: { email, name, passwordHash: 'x', teamId },
      select: { id: true },
    });
  const approval = (userId: string) =>
    db.prisma.timesheetApproval.create({
      data: { userId, periodStart: P_START, periodEnd: P_END, status: 'PENDING' },
      select: { id: true },
    });
  const entry = (userId: string, id: string, s: string, e: string) =>
    db.prisma.timeEntry.create({
      data: { id, userId, source: 'MANUAL', startTime: new Date(s), endTime: new Date(e) },
    });

  it('lists a PENDING row with live trackedSeconds and userName, scoped by user', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    await approval(ada.id);
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000b001',
      '2026-06-30T09:00:00Z',
      '2026-06-30T10:30:00Z',
    ); // 5400s in-period
    const rows = await repo().list({ kind: 'user', userId: ada.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userName).toBe('Ada');
    expect(rows[0]!.trackedSeconds).toBe(5400);
    expect(rows[0]!.totalSeconds).toBeNull();
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('team scope includes only that team; all scope spans teams', async () => {
    const t1 = await team();
    const t2 = await team();
    const a = await user(t1.id, 'Ada', 'ada@example.com');
    const z = await user(t2.id, 'Zoe', 'zoe@example.com');
    await approval(a.id);
    await approval(z.id);
    expect((await repo().list({ kind: 'team', teamId: t1.id })).map((r) => r.userName)).toEqual([
      'Ada',
    ]);
    expect((await repo().list({ kind: 'all' })).map((r) => r.userName).sort()).toEqual([
      'Ada',
      'Zoe',
    ]);
  });

  it('applies the status filter (exercises the enum predicate)', async () => {
    const t = await team();
    const a = await user(t.id, 'Ada', 'ada@example.com');
    const b = await user(t.id, 'Bea', 'bea@example.com');
    const pending = await approval(a.id);
    void pending;
    const decided = await db.prisma.timesheetApproval.create({
      data: {
        userId: b.id,
        periodStart: new Date('2026-06-22T00:00:00.000Z'),
        periodEnd: new Date('2026-06-29T00:00:00.000Z'),
        status: 'APPROVED',
        totalSeconds: 3600,
        decidedAt: new Date(),
      },
      select: { id: true },
    });
    void decided;
    expect(
      (await repo().list({ kind: 'team', teamId: t.id }, 'PENDING')).map((r) => r.userName),
    ).toEqual(['Ada']);
    expect(
      (await repo().list({ kind: 'team', teamId: t.id }, 'APPROVED')).map((r) => r.userName),
    ).toEqual(['Bea']);
  });

  it('decide updates the row AND writes one AuditLog row in the same tx; re-decide audits again', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    const { id } = await approval(ada.id);
    const first = await repo().decide(id, {
      status: 'APPROVED',
      note: 'ok',
      reviewerId: ada.id,
      totalSeconds: 5400,
      prevStatus: 'PENDING',
    });
    expect(first.status).toBe('APPROVED');
    expect(first.totalSeconds).toBe(5400);
    expect(first.reviewerId).toBe(ada.id);
    expect(first.decidedAt).not.toBeNull();
    let audits = await db.prisma.auditLog.findMany({
      where: { targetType: 'TimesheetApproval', targetId: id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('timesheet.decide');

    await repo().decide(id, {
      status: 'FLAGGED',
      note: 'redo',
      reviewerId: ada.id,
      totalSeconds: 5400,
      prevStatus: 'APPROVED',
    });
    audits = await db.prisma.auditLog.findMany({
      where: { targetType: 'TimesheetApproval', targetId: id },
    });
    expect(audits).toHaveLength(2);
  });

  it('enforces (userId, periodStart) uniqueness', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    await approval(ada.id);
    await expect(approval(ada.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('periodTrackedSeconds sums clamped whole-second durations for the window', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000b002',
      '2026-06-30T09:00:00Z',
      '2026-06-30T10:00:00Z',
    );
    expect(await repo().periodTrackedSeconds(ada.id, P_START, P_END)).toBe(3600);
  });
});

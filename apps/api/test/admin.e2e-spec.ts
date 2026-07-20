import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID, UpdateSettingsSchema } from '@timetrack/contracts';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('admin settings — real Postgres', () => {
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

  function svc(): AdminService {
    return new AdminService(new AdminRepository(db.prisma as unknown as PrismaService));
  }

  it('merges + validates settings, persists them, and writes an audit row', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const actor: SessionUser = { id: 'admin1', role: 'ADMIN', teamId: team.id };

    const result = await svc().updateSettings({ screenshotIntervalMinutes: 15 }, actor);
    expect(result.screenshotIntervalMinutes).toBe(15);
    expect(result.screenshotRetentionDays).toBe(30); // default filled

    const stored = await db.prisma.team.findUnique({
      where: { id: team.id },
      select: { settings: true },
    });
    expect(
      (stored?.settings as { screenshotIntervalMinutes: number }).screenshotIntervalMinutes,
    ).toBe(15);

    const audit = await db.prisma.auditLog.findMany({ where: { targetId: team.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('team.update_settings');
    expect(
      (audit[0]?.diff as { after: { screenshotIntervalMinutes: number } }).after
        .screenshotIntervalMinutes,
    ).toBe(15);
  });

  it('a partial patch preserves unspecified stored settings (no silent capture re-enable)', async () => {
    const team = await db.prisma.team.create({
      data: {
        name: 'Eng',
        settings: { screenshotsEnabled: false, captureWindowTitles: false, screenshotRetentionDays: 90 },
      },
    });
    const actor: SessionUser = { id: 'admin1', role: 'ADMIN', teamId: team.id };
    const patch = UpdateSettingsSchema.parse({ idleThresholdMinutes: 10 }); // what the pipe produces
    const result = await svc().updateSettings(patch, actor);

    expect(result.idleThresholdMinutes).toBe(10); // applied
    expect(result.screenshotsEnabled).toBe(false); // preserved — NOT re-enabled
    expect(result.captureWindowTitles).toBe(false); // preserved
    expect(result.screenshotRetentionDays).toBe(90); // preserved
  });
});

describe.runIf(RUN_E2E)('admin audit-log — keyset paging + actor resolution', () => {
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

  function svc(): AdminService {
    return new AdminService(new AdminRepository(db.prisma as unknown as PrismaService));
  }

  // Insert an audit row at an explicit timestamp with a chosen id + actor.
  async function audit(id: string, actorId: string, ts: string, targetType = 'user') {
    await db.prisma.auditLog.create({
      data: {
        id,
        actorId,
        action: 'x.test',
        targetType,
        targetId: 'tid',
        diff: {},
        timestamp: new Date(ts),
      },
    });
  }

  it('resolves a real actor to name/email and leaves SYSTEM as null/null', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const user = await db.prisma.user.create({
      data: { email: 'ada@x.com', name: 'Ada', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
    await audit('019797a0-0000-7000-8000-00000000a001', user.id, '2026-07-20T10:00:00Z');
    await audit(
      '019797a0-0000-7000-8000-00000000a002',
      SYSTEM_ACTOR_ID,
      '2026-07-20T09:00:00Z',
      'system',
    );

    const page = await svc().listAudit({ limit: 50 } as never);
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get('019797a0-0000-7000-8000-00000000a001')?.actorName).toBe('Ada');
    expect(byId.get('019797a0-0000-7000-8000-00000000a001')?.actorEmail).toBe('ada@x.com');
    expect(byId.get('019797a0-0000-7000-8000-00000000a002')?.actorName).toBeNull();
    expect(byId.get('019797a0-0000-7000-8000-00000000a002')?.actorEmail).toBeNull();
  });

  it('DISCRIMINATING: pages rows that SHARE a timestamp with no skip or duplicate', async () => {
    const ts = '2026-07-20T12:00:00Z';
    const ids = [
      '019797a0-0000-7000-8000-0000000000e1',
      '019797a0-0000-7000-8000-0000000000e2',
      '019797a0-0000-7000-8000-0000000000e3',
      '019797a0-0000-7000-8000-0000000000e4',
      '019797a0-0000-7000-8000-0000000000e5',
    ];
    for (const id of ids) await audit(id, SYSTEM_ACTOR_ID, ts); // identical timestamp

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await svc().listAudit({ limit: 2, ...(cursor ? { cursor } : {}) } as never);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull(); // terminated cleanly
    expect(seen).toHaveLength(ids.length); // no duplicates
    expect(new Set(seen).size).toBe(ids.length); // every id exactly once
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('applies the targetType filter', async () => {
    await audit(
      '019797a0-0000-7000-8000-00000000b001',
      SYSTEM_ACTOR_ID,
      '2026-07-20T08:00:00Z',
      'user',
    );
    await audit(
      '019797a0-0000-7000-8000-00000000b002',
      SYSTEM_ACTOR_ID,
      '2026-07-20T08:00:01Z',
      'team',
    );
    const page = await svc().listAudit({ targetType: 'team', limit: 50 } as never);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.targetType).toBe('team');
  });
});

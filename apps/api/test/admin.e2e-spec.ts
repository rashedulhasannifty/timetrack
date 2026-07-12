import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
});

import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { TeamsService } from '../src/modules/teams/teams.service.js';
import type { MinioService } from '../src/infra/storage/minio.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * The Teams admin surface against a real Postgres. The property under test throughout is that
 * a team the admin is NOT a member of behaves exactly like their own: it can be listed with a
 * true member count, renamed, and — the regression this slice exists for — have its monitoring
 * policy edited. Every settings write used to resolve `actor.teamId`, which left a second
 * team's policy frozen at its creation defaults with no way to change it.
 */
describe.runIf(RUN_E2E)('teams admin — real Postgres', () => {
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

  const prisma = () => db.prisma as unknown as PrismaService;
  const teamsSvc = () => new TeamsService(new TeamsRepository(prisma()));
  // Storage is untouched by these paths; erase is the only method that reaches for it.
  const adminSvc = () =>
    new AdminService(new AdminRepository(prisma()), {} as unknown as MinioService);

  function team(name: string) {
    return db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
  }
  function member(teamId: string, email: string) {
    return db.prisma.user.create({
      data: { email, name: email.split('@')[0]!, role: 'EMPLOYEE', teamId, passwordHash: 'x' },
      select: { id: true },
    });
  }
  const actor = (teamId: string): SessionUser => ({ id: 'admin-1', role: 'ADMIN', teamId });

  describe('list', () => {
    it('reports each team’s real member count, ordered by name', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');
      await member(eng.id, 'ada@ex.co');
      await member(eng.id, 'grace@ex.co');

      const teams = await teamsSvc().list();
      expect(teams.map((t) => [t.name, t.memberCount])).toEqual([
        ['Engineering', 2],
        ['Support', 0],
      ]);
      expect(teams.map((t) => t.id)).toEqual([eng.id, support.id]);
    });

    it('gives a never-edited team a complete default policy', async () => {
      await team('Support');
      const [only] = await teamsSvc().list();
      expect(only?.settings.screenshotIntervalMinutes).toBe(10);
      expect(only?.settings.screenshotRetentionDays).toBe(30);
    });
  });

  describe('rename', () => {
    it('renames a team the admin is not in, and audits the before/after', async () => {
      const eng = await team('Engineering');
      const support = await team('Suport'); // typo — the reason rename exists

      const renamed = await teamsSvc().rename(support.id, { name: 'Support' }, actor(eng.id));
      expect(renamed.name).toBe('Support');

      const stored = await db.prisma.team.findUnique({
        where: { id: support.id },
        select: { name: true },
      });
      expect(stored?.name).toBe('Support');

      const audit = await db.prisma.auditLog.findMany({ where: { targetId: support.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('team.rename');
      expect(audit[0]!.diff).toEqual({ before: { name: 'Suport' }, after: { name: 'Support' } });
    });

    it('leaves the team’s settings untouched — a rename is an identity change', async () => {
      const eng = await team('Engineering');
      await adminSvc().updateSettings({ screenshotIntervalMinutes: 45 }, actor(eng.id));

      await teamsSvc().rename(eng.id, { name: 'Platform' }, actor(eng.id));

      const [only] = await teamsSvc().list();
      expect(only?.name).toBe('Platform');
      expect(only?.settings.screenshotIntervalMinutes).toBe(45);
    });

    it('404s on an unknown team and writes no audit row', async () => {
      const eng = await team('Engineering');
      const missing = '01920000-0000-7000-8000-0000000000ff';

      await expect(
        teamsSvc().rename(missing, { name: 'Ghost' }, actor(eng.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(db.prisma.auditLog.count()).resolves.toBe(0);
    });
  });

  describe('per-team monitoring policy', () => {
    it('edits another team’s policy and leaves the admin’s own team alone', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');

      const result = await adminSvc().updateSettings(
        { screenshotsEnabled: false, screenshotIntervalMinutes: 30 },
        actor(eng.id),
        support.id,
      );
      expect(result.screenshotsEnabled).toBe(false);

      const teams = await teamsSvc().list();
      const engRow = teams.find((t) => t.id === eng.id);
      const supportRow = teams.find((t) => t.id === support.id);
      expect(supportRow?.settings.screenshotsEnabled).toBe(false);
      expect(supportRow?.settings.screenshotIntervalMinutes).toBe(30);
      // The admin's own team must be exactly as it was — this is the bug, inverted.
      expect(engRow?.settings.screenshotsEnabled).toBe(true);
      expect(engRow?.settings.screenshotIntervalMinutes).toBe(10);
    });

    it('audits the change against the team that was edited, not the actor’s team', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');

      await adminSvc().updateSettings({ screenshotBlur: 'BLUR' }, actor(eng.id), support.id);

      const audit = await db.prisma.auditLog.findMany();
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('team.update_settings');
      expect(audit[0]!.targetId).toBe(support.id);
      expect(audit[0]!.actorId).toBe('admin-1');
    });

    it('still defaults to the actor’s own team when no id is passed', async () => {
      const eng = await team('Engineering');
      await team('Support');

      await adminSvc().updateSettings({ idleThresholdMinutes: 12 }, actor(eng.id));

      const teams = await teamsSvc().list();
      expect(teams.find((t) => t.id === eng.id)?.settings.idleThresholdMinutes).toBe(12);
      expect(teams.find((t) => t.name === 'Support')?.settings.idleThresholdMinutes).toBe(5);
    });

    it('404s on an unknown team instead of writing nowhere', async () => {
      const eng = await team('Engineering');
      const missing = '01920000-0000-7000-8000-0000000000ff';

      await expect(
        adminSvc().updateSettings({ screenshotsEnabled: false }, actor(eng.id), missing),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(db.prisma.auditLog.count()).resolves.toBe(0);
    });
  });
});

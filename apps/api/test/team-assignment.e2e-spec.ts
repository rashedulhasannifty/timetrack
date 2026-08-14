import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { TeamsService } from '../src/modules/teams/teams.service.js';
import type { InvitesService } from '../src/modules/invites/invites.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * Assigning an employee to a manager IS moving them between teams, because a MANAGER manages
 * their own team. These cover the write path and the authorization model that had to change
 * with it: an ADMIN is now org-wide, and the last-admin guard counts the deployment, not a team.
 */
describe.runIf(RUN_E2E)('team assignment — real Postgres', () => {
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
  const usersRepo = () => new UsersRepository(prisma());
  const usersSvc = () => new UsersService(usersRepo(), {} as unknown as InvitesService);
  const teamsSvc = () => new TeamsService(new TeamsRepository(prisma()));

  function team(name: string) {
    return db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
  }
  function user(
    teamId: string,
    email: string,
    role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN' = 'EMPLOYEE',
  ) {
    return db.prisma.user.create({
      data: { email, name: email.split('@')[0]!, role, teamId, passwordHash: 'x' },
      select: { id: true },
    });
  }
  const actor = (id: string, teamId: string): SessionUser => ({ id, role: 'ADMIN', teamId });

  describe('moving a user to another team', () => {
    it('moves them and audits it as a permissions change', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');
      const ada = await user(eng.id, 'ada@ex.co');

      const moved = await usersSvc().update(
        ada.id,
        { teamId: support.id },
        actor(admin.id, eng.id),
      );
      expect(moved.teamId).toBe(support.id);

      const audit = await db.prisma.auditLog.findMany({ where: { targetId: ada.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('user.team_change');
      // The from/to pair is the record that the visibility boundary moved.
      expect(audit[0]!.diff).toEqual({ from: eng.id, to: support.id });
      expect(audit[0]!.actorId).toBe(admin.id);
    });

    it('moves a user who is NOT in the admin’s own team — ADMIN is org-wide now', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');
      const sales = await team('Sales');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');
      const sam = await user(support.id, 'sam@ex.co'); // neither team is the admin's

      const moved = await usersSvc().update(sam.id, { teamId: sales.id }, actor(admin.id, eng.id));
      expect(moved.teamId).toBe(sales.id);
    });

    it('rejects an unknown destination team with 422 and leaves the user put', async () => {
      const eng = await team('Engineering');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');
      const ada = await user(eng.id, 'ada@ex.co');

      await expect(
        usersSvc().update(
          ada.id,
          { teamId: '019797a0-0000-7000-8000-0000000000ff' },
          actor(admin.id, eng.id),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      const after = await db.prisma.user.findUniqueOrThrow({ where: { id: ada.id } });
      expect(after.teamId).toBe(eng.id);
      expect(await db.prisma.auditLog.count()).toBe(0);
    });

    it('writes no audit row when the user is already on that team', async () => {
      const eng = await team('Engineering');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');
      const ada = await user(eng.id, 'ada@ex.co');

      const same = await usersSvc().update(ada.id, { teamId: eng.id }, actor(admin.id, eng.id));
      expect(same.teamId).toBe(eng.id);
      expect(await db.prisma.auditLog.count()).toBe(0);
    });

    it('carries the user’s history with them — the new team’s manager sees it, the old one does not', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');
      const ada = await user(eng.id, 'ada@ex.co');
      await db.prisma.timeEntry.create({
        data: {
          id: '019797a0-0000-7000-8000-00000000e001',
          userId: ada.id,
          source: 'MANUAL',
          startTime: new Date('2026-08-04T09:00:00Z'),
          endTime: new Date('2026-08-04T10:00:00Z'),
        },
      });

      await usersSvc().update(ada.id, { teamId: support.id }, actor(admin.id, eng.id));

      // Membership is resolved at read time, so the move is retroactive by construction: the
      // entry did not change teams, the person did. This is the privacy consequence worth
      // asserting explicitly rather than discovering later.
      const engMembers = await usersRepo().listByTeam(eng.id);
      const supportMembers = await usersRepo().listByTeam(support.id);
      expect(engMembers.map((u) => u.id)).not.toContain(ada.id);
      expect(supportMembers.map((u) => u.id)).toContain(ada.id);
      const entries = await db.prisma.timeEntry.count({ where: { userId: ada.id } });
      expect(entries).toBe(1);
    });
  });

  describe('last-admin guard is org-wide, not per-team', () => {
    it('allows demoting a team’s only admin while another team still has one', async () => {
      // Under the old per-team count this was a 409 even though the org kept an admin.
      const eng = await team('Engineering');
      const support = await team('Support');
      const engAdmin = await user(eng.id, 'a1@ex.co', 'ADMIN');
      const supportAdmin = await user(support.id, 'a2@ex.co', 'ADMIN');

      const result = await usersRepo().setRole(engAdmin.id, 'EMPLOYEE', supportAdmin.id);
      expect(result.status).toBe('OK');
    });

    it('still refuses to demote the deployment’s final admin', async () => {
      const eng = await team('Engineering');
      const only = await user(eng.id, 'a1@ex.co', 'ADMIN');
      await user(eng.id, 'e1@ex.co'); // a non-admin does not count

      const result = await usersRepo().setRole(only.id, 'EMPLOYEE', only.id);
      expect(result.status).toBe('LAST_ADMIN');
    });

    it('still refuses to deactivate the deployment’s final admin', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');
      const only = await user(eng.id, 'a1@ex.co', 'ADMIN');
      await user(support.id, 'm1@ex.co', 'MANAGER');

      const result = await usersRepo().setActive(only.id, true, only.id);
      expect(result.status).toBe('LAST_ADMIN');
    });
  });

  describe('roster scope', () => {
    it('gives an ADMIN every team’s people and a MANAGER only their own', async () => {
      const eng = await team('Engineering');
      const support = await team('Support');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');
      const ada = await user(eng.id, 'ada@ex.co');
      const sam = await user(support.id, 'sam@ex.co');
      const mgr = await user(support.id, 'mgr@ex.co', 'MANAGER');

      const asAdmin = await usersSvc().list(actor(admin.id, eng.id));
      expect(asAdmin.map((u) => u.id).sort()).toEqual([admin.id, ada.id, sam.id, mgr.id].sort());

      const asManager = await usersSvc().list({ id: mgr.id, role: 'MANAGER', teamId: support.id });
      expect(asManager.map((u) => u.id).sort()).toEqual([sam.id, mgr.id].sort());
    });
  });

  describe('teams', () => {
    it('creates a team on default settings and audits it', async () => {
      const eng = await team('Engineering');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');

      const created = await teamsSvc().create({ name: 'Support' }, actor(admin.id, eng.id));
      expect(created.name).toBe('Support');
      // A default-free partial merged over the read schema yields a COMPLETE policy.
      expect(created.settings.screenshotIntervalMinutes).toBe(10);
      expect(created.settings.timesheetReminderHours).toBe(0);

      const audit = await db.prisma.auditLog.findMany({ where: { targetId: created.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('team.create');
    });

    it('applies a partial settings override without dropping the other defaults', async () => {
      const eng = await team('Engineering');
      const admin = await user(eng.id, 'admin@ex.co', 'ADMIN');

      const created = await teamsSvc().create(
        { name: 'Contractors', settings: { screenshotsEnabled: false } },
        actor(admin.id, eng.id),
      );
      expect(created.settings.screenshotsEnabled).toBe(false);
      expect(created.settings.screenshotRetentionDays).toBe(30); // untouched default
    });

    it('lists every team by name for the picker', async () => {
      await team('Support');
      await team('Engineering');
      const names = (await teamsSvc().list()).map((t) => t.name);
      expect(names).toEqual(['Engineering', 'Support']);
    });
  });
});

import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';
import {
  WorkTypesRepository,
  RECONCILE_TX,
} from '../src/modules/work-types/work-types.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/** The two raw-SQL indexes Prisma cannot model or diff (spec §4). */
describe.runIf(RUN_E2E)('work types — schema', () => {
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

  async function seedProject() {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    return db.prisma.project.create({
      data: { teamId: team.id, name: 'Acme' },
      select: { id: true, teamId: true },
    });
  }

  it('refuses a second catalog name that differs only by case', async () => {
    await db.prisma.workType.create({ data: { name: 'Payroll' } });
    await expect(db.prisma.workType.create({ data: { name: 'PAYROLL' } })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('refuses a second subproject for the same work type on one project', async () => {
    const p = await seedProject();
    const wt = await db.prisma.workType.create({ data: { name: 'Payroll' }, select: { id: true } });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'Payroll', workTypeId: wt.id },
    });
    await expect(
      db.prisma.subproject.create({
        data: { projectId: p.id, name: 'Payroll again', workTypeId: wt.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of unlinked subprojects on one project', async () => {
    const p = await seedProject();
    await db.prisma.subproject.createMany({
      data: [
        { projectId: p.id, name: 'A' },
        { projectId: p.id, name: 'B' },
      ],
    });
    await expect(
      db.prisma.subproject.count({ where: { projectId: p.id, workTypeId: null } }),
    ).resolves.toBe(2);
  });

  it('keys a team selection on (teamId, workTypeId)', async () => {
    const p = await seedProject();
    const wt = await db.prisma.workType.create({ data: { name: 'Payroll' }, select: { id: true } });
    await db.prisma.teamWorkType.create({ data: { teamId: p.teamId, workTypeId: wt.id } });
    await expect(
      db.prisma.teamWorkType.create({ data: { teamId: p.teamId, workTypeId: wt.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe.runIf(RUN_E2E)('work types — reconcile', () => {
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

  const ACTOR = '01920000-0000-7000-8000-0000000000a1';
  const repo = () => new WorkTypesRepository(db.prisma as unknown as PrismaService);

  async function team(name: string): Promise<string> {
    const t = await db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
    return t.id;
  }
  /** A project as old code made it: the project and its General default, nothing else. */
  async function project(teamId: string, name: string): Promise<string> {
    const p = await db.prisma.project.create({ data: { teamId, name }, select: { id: true } });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'General', isDefault: true },
    });
    return p.id;
  }
  async function workType(name: string): Promise<string> {
    const w = await db.prisma.workType.create({ data: { name }, select: { id: true } });
    return w.id;
  }
  async function enable(teamId: string, ...workTypeIds: string[]): Promise<void> {
    await db.prisma.teamWorkType.createMany({
      data: workTypeIds.map((workTypeId) => ({ teamId, workTypeId })),
    });
  }
  function reconcile(projectIds: string[]) {
    return db.prisma.$transaction(
      (tx) =>
        repo().reconcile(tx, projectIds, {
          actorId: ACTOR,
          trigger: 'resync',
          targetType: 'work_type',
          targetId: 'all',
        }),
      RECONCILE_TX,
    );
  }
  function subs(projectId: string) {
    return db.prisma.subproject.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, archived: true, isDefault: true, workTypeId: true },
    });
  }
  const ZERO = { created: 0, linked: 0, restored: 0, renamed: 0, archived: 0 };

  it("enabling a work type creates a row on every one of the team's projects", async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const b = await project(eng, 'Globex');
    const payroll = await workType('Payroll');
    const audit = await workType('Audit Assist');
    await enable(eng, payroll, audit);

    await expect(reconcile([a, b])).resolves.toEqual({ ...ZERO, projects: 2, created: 4 });
    for (const id of [a, b]) {
      const rows = await subs(id);
      expect(rows.map((r) => [r.name, r.workTypeId])).toEqual([
        ['General', null],
        ['Audit Assist', audit],
        ['Payroll', payroll],
      ]);
    }
  });

  it("leaves another team's projects alone", async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const a = await project(eng, 'Acme');
    const c = await project(support, 'Initech');
    await enable(eng, await workType('Payroll'));

    await expect(reconcile([a, c])).resolves.toEqual({ ...ZERO, projects: 2, created: 1 });
    expect((await subs(c)).map((r) => r.name)).toEqual(['General']);
  });

  it('disabling archives the rows and never deletes them', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const payroll = await workType('Payroll');
    await enable(eng, payroll);
    await reconcile([a]);

    await db.prisma.teamWorkType.deleteMany({ where: { teamId: eng } });
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, archived: 1 });
    const row = (await subs(a)).find((r) => r.workTypeId === payroll);
    expect(row?.archived).toBe(true);
  });

  it('re-enabling restores the same row id', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const payroll = await workType('Payroll');
    await enable(eng, payroll);
    await reconcile([a]);
    const first = (await subs(a)).find((r) => r.workTypeId === payroll);

    await db.prisma.teamWorkType.deleteMany({ where: { teamId: eng } });
    await reconcile([a]);
    await enable(eng, payroll);
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, restored: 1 });

    const again = (await subs(a)).find((r) => r.workTypeId === payroll);
    expect(again?.id).toBe(first?.id);
    expect(again?.archived).toBe(false);
  });

  it('renaming a work type renames its linked rows in place', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const vat = await workType('VAT Filling');
    await enable(eng, vat);
    await reconcile([a]);
    const before = (await subs(a)).find((r) => r.workTypeId === vat);

    await db.prisma.workType.update({ where: { id: vat }, data: { name: 'VAT/TAX Filling' } });
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, renamed: 1 });
    const after = (await subs(a)).find((r) => r.workTypeId === vat);
    expect(after).toMatchObject({ id: before?.id, name: 'VAT/TAX Filling' });
  });

  it('archiving a work type archives its rows', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const payroll = await workType('Payroll');
    await enable(eng, payroll);
    await reconcile([a]);

    await db.prisma.workType.update({ where: { id: payroll }, data: { archived: true } });
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, archived: 1 });
  });

  it('adopts a hand-made same-name row, even an archived one, instead of duplicating', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const handMade = await db.prisma.subproject.create({
      data: { projectId: a, name: 'payroll', archived: true },
      select: { id: true },
    });
    const payroll = await workType('Payroll');
    await enable(eng, payroll);

    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, linked: 1 });
    const rows = await subs(a);
    expect(rows.filter((r) => r.name.toLowerCase() === 'payroll')).toEqual([
      { id: handMade.id, name: 'Payroll', archived: false, isDefault: false, workTypeId: payroll },
    ]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    await enable(eng, await workType('Payroll'), await workType('AdHoc'));
    await reconcile([a]);

    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1 });
  });

  it('writes exactly one work_type.reconcile audit row per call, even a no-op', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    await enable(eng, await workType('Payroll'));
    await reconcile([a]);
    await reconcile([a]);

    const rows = await db.prisma.auditLog.findMany({
      where: { action: 'work_type.reconcile' },
      orderBy: { timestamp: 'asc' },
      select: { actorId: true, targetType: true, targetId: true, diff: true },
    });
    expect(rows).toEqual([
      {
        actorId: ACTOR,
        targetType: 'work_type',
        targetId: 'all',
        diff: { trigger: 'resync', projects: 1, ...ZERO, created: 1 },
      },
      {
        actorId: ACTOR,
        targetType: 'work_type',
        targetId: 'all',
        diff: { trigger: 'resync', projects: 1, ...ZERO },
      },
    ]);
  });

  it('accepts an empty project list', async () => {
    await expect(reconcile([])).resolves.toEqual({ ...ZERO, projects: 0 });
  });
});

describe('work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

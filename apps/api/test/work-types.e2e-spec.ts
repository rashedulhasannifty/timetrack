import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';
import {
  CONCURRENT_CHANGE,
  WorkTypesRepository,
  RECONCILE_TX,
} from '../src/modules/work-types/work-types.repository.js';
import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import { WorkTypesService } from '../src/modules/work-types/work-types.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
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

describe.runIf(RUN_E2E)('work types — service', () => {
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

  const ADMIN_ID = '01920000-0000-7000-8000-0000000000a1';
  const MISSING = '01920000-0000-7000-8000-0000000000ff';
  const svc = () =>
    new WorkTypesService(new WorkTypesRepository(db.prisma as unknown as PrismaService));
  const admin = (teamId: string): SessionUser => ({ id: ADMIN_ID, role: 'ADMIN', teamId });

  async function team(name: string): Promise<string> {
    const t = await db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
    return t.id;
  }
  async function project(teamId: string, name: string): Promise<string> {
    const p = await db.prisma.project.create({ data: { teamId, name }, select: { id: true } });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'General', isDefault: true },
    });
    return p.id;
  }
  async function catalog(teamId: string, ...names: string[]) {
    const { created } = await svc().bulkCreate({ names }, admin(teamId));
    return new Map(created.map((w) => [w.name, w.id] as const));
  }
  async function titleOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      return e instanceof HttpException ? (e.getResponse() as { title?: string }).title : undefined;
    }
  }
  const linked = (projectId: string) =>
    db.prisma.subproject.findMany({
      where: { projectId, workTypeId: { not: null } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, archived: true, workTypeId: true },
    });

  it('bulk-creates, and skips reserved, existing, repeated and over-long names', async () => {
    const eng = await team('Eng');
    await catalog(eng, 'Payroll');
    const long = 'x'.repeat(201);

    const result = await svc().bulkCreate(
      { names: ['Bookkeeping', 'payroll', 'General', 'Bookkeeping ', 'AdHoc', long] },
      admin(eng),
    );
    expect(result.created.map((w) => w.name).sort()).toEqual(['AdHoc', 'Bookkeeping']);
    expect(result.skipped).toEqual([
      { name: 'payroll', reason: 'Already in the catalog' },
      { name: 'General', reason: 'Reserved name' },
      { name: 'Bookkeeping', reason: 'Duplicate in list' },
      { name: long, reason: 'Longer than 200 characters' },
    ]);
    await expect(db.prisma.auditLog.count({ where: { action: 'work_type.create' } })).resolves.toBe(
      3,
    );
  });

  it('the index backstops a case-insensitive duplicate the service did not see', async () => {
    const eng = await team('Eng');
    await catalog(eng, 'Payroll');
    const repo = new WorkTypesRepository(db.prisma as unknown as PrismaService);
    await expect(repo.createMany(['PAYROLL'], ADMIN_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s a rename to "General" and to another work type’s name, case-insensitively', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const adhoc = ids.get('AdHoc')!;
    await expect(svc().update(adhoc, { name: 'GENERAL' }, admin(eng))).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc().update(adhoc, { name: 'payroll' }, admin(eng))).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc().update(adhoc, { name: 'ADHOC' }, admin(eng))).resolves.toMatchObject({
      name: 'ADHOC',
    });
  });

  it('maps a deadlock or serialization failure (P2034) in the reconcile to the concurrent-change 409', async () => {
    const eng = await team('Eng');
    await project(eng, 'Acme');
    const payroll = (await catalog(eng, 'Payroll')).get('Payroll')!;
    const repo = new WorkTypesRepository(db.prisma as unknown as PrismaService);
    repo.reconcile = () =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );

    for (const attempt of [
      () => repo.setTeamSelection(eng, [payroll], ADMIN_ID),
      () => repo.update(payroll, { name: 'Pay' }, ADMIN_ID),
      () => repo.resync(ADMIN_ID),
    ]) {
      expect(await titleOf(attempt())).toBe(CONCURRENT_CHANGE);
    }
    // Every transaction rolled back.
    await expect(db.prisma.teamWorkType.count()).resolves.toBe(0);
    await expect(
      db.prisma.workType.findUniqueOrThrow({ where: { id: payroll }, select: { name: true } }),
    ).resolves.toEqual({ name: 'Payroll' });
  });

  it('update keeps the duplicate-name title for the name index only', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const repo = new WorkTypesRepository(db.prisma as unknown as PrismaService);
    // Straight to the repository, past the service's pre-check: the index itself answers.
    expect(await titleOf(repo.update(ids.get('AdHoc')!, { name: 'PAYROLL' }, ADMIN_ID))).toBe(
      'A work type with this name already exists',
    );

    // A unique violation raised by the reconcile (another index, or no index named) is a race.
    const otherIndex = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { index: 'subprojects_one_per_work_type' },
          },
        },
      },
    });
    const bare = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    for (const clash of [otherIndex, bare]) {
      repo.reconcile = () => Promise.reject(clash);
      expect(await titleOf(repo.update(ids.get('AdHoc')!, { name: 'Ad hoc' }, ADMIN_ID))).toBe(
        CONCURRENT_CHANGE,
      );
    }
  });

  it('lists work types by name with the teams that selected them', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    await svc().setTeamSelection(eng, { workTypeIds: [ids.get('Payroll')!] }, admin(eng));

    await expect(svc().list()).resolves.toEqual([
      { id: ids.get('AdHoc'), name: 'AdHoc', archived: false, teamIds: [] },
      { id: ids.get('Payroll'), name: 'Payroll', archived: false, teamIds: [eng] },
    ]);
  });

  it("saving a team's selection creates rows on its projects and archives dropped ones", async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const b = await project(eng, 'Globex');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const payroll = ids.get('Payroll')!;
    const adhoc = ids.get('AdHoc')!;

    const saved = await svc().setTeamSelection(eng, { workTypeIds: [payroll, adhoc] }, admin(eng));
    expect(saved).toEqual({ teamId: eng, workTypeIds: [payroll, adhoc].sort() });
    for (const p of [a, b]) {
      expect((await linked(p)).map((r) => r.name)).toEqual(['AdHoc', 'Payroll']);
    }

    await svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng));
    const rows = await linked(a);
    expect(rows.find((r) => r.workTypeId === adhoc)?.archived).toBe(true);
    expect(rows.find((r) => r.workTypeId === payroll)?.archived).toBe(false);

    // Sorted, not ordered by timestamp: both rows of one save share the transaction's now().
    const actions = await db.prisma.auditLog.findMany({
      where: { targetType: 'team', targetId: eng },
      select: { action: true },
    });
    expect(actions.map((x) => x.action).sort()).toEqual([
      'team.work_types_set',
      'team.work_types_set',
      'work_type.reconcile',
      'work_type.reconcile',
    ]);
  });

  it('404s an unknown team or work type and 422s an archived one, writing nothing', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll');
    const payroll = ids.get('Payroll')!;
    await svc().update(payroll, { archived: true }, admin(eng));
    const auditBefore = await db.prisma.auditLog.count();

    await expect(
      svc().setTeamSelection(MISSING, { workTypeIds: [] }, admin(eng)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc().setTeamSelection(eng, { workTypeIds: [MISSING] }, admin(eng)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(db.prisma.auditLog.count()).resolves.toBe(auditBefore);
  });

  it('an archived selection survives a column save and restore brings back the same rows', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const payroll = ids.get('Payroll')!;
    const adhoc = ids.get('AdHoc')!;
    await svc().setTeamSelection(eng, { workTypeIds: [payroll, adhoc] }, admin(eng));
    const original = (await linked(a)).find((r) => r.workTypeId === payroll);

    await svc().update(payroll, { archived: true }, admin(eng));
    // The dashboard never submits an archived row's checkbox (ruling R5).
    const saved = await svc().setTeamSelection(eng, { workTypeIds: [adhoc] }, admin(eng));
    expect(saved.workTypeIds).toEqual([payroll, adhoc].sort());

    await svc().update(payroll, { archived: false }, admin(eng));
    const restored = (await linked(a)).find((r) => r.workTypeId === payroll);
    expect(restored).toEqual({ ...original, archived: false });
  });

  it('renaming a work type renames every linked row; archiving it archives them', async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const a = await project(eng, 'Acme');
    const c = await project(support, 'Initech');
    const vat = (await catalog(eng, 'VAT Filling')).get('VAT Filling')!;
    await svc().setTeamSelection(eng, { workTypeIds: [vat] }, admin(eng));
    await svc().setTeamSelection(support, { workTypeIds: [vat] }, admin(eng));

    await svc().update(vat, { name: 'VAT/TAX Filling' }, admin(eng));
    for (const p of [a, c]) {
      expect((await linked(p)).map((r) => r.name)).toEqual(['VAT/TAX Filling']);
    }
    await svc().update(vat, { archived: true }, admin(eng));
    for (const p of [a, c]) {
      expect((await linked(p)).map((r) => r.archived)).toEqual([true]);
    }
  });

  it('re-sync repairs a project made by old code, and a second run returns all zeros', async () => {
    const eng = await team('Eng');
    await project(eng, 'Acme');
    const payroll = (await catalog(eng, 'Payroll')).get('Payroll')!;
    await svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng));
    const late = await project(eng, 'Created during the deploy window');

    await expect(svc().resync(admin(eng))).resolves.toEqual({
      projects: 2,
      created: 1,
      linked: 0,
      restored: 0,
      renamed: 0,
      archived: 0,
    });
    expect((await linked(late)).map((r) => r.name)).toEqual(['Payroll']);
    await expect(svc().resync(admin(eng))).resolves.toEqual({
      projects: 2,
      created: 0,
      linked: 0,
      restored: 0,
      renamed: 0,
      archived: 0,
    });
  });

  it('concurrent saves never duplicate or 500', async () => {
    const eng = await team('Eng');
    const projects = await Promise.all(['A', 'B', 'C'].map((n) => project(eng, n)));
    const ids = [...(await catalog(eng, 'Payroll', 'AdHoc', 'Audit')).values()];

    const results = await Promise.allSettled([
      svc().setTeamSelection(eng, { workTypeIds: ids }, admin(eng)),
      svc().setTeamSelection(eng, { workTypeIds: ids }, admin(eng)),
      svc().resync(admin(eng)),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    // Asserted BEFORE any re-sync: a settling re-sync would hide a race that left rows wrong.
    for (const p of projects) {
      const rows = await linked(p);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => !r.archived)).toBe(true);
    }
    // And the state really is settled: a re-sync finds nothing to do.
    await expect(svc().resync(admin(eng))).resolves.toEqual({
      projects: 3,
      created: 0,
      linked: 0,
      restored: 0,
      renamed: 0,
      archived: 0,
    });
  });

  /**
   * The whole-branch review's I1: reconciles read team_work_types, work_types and subprojects in
   * separate READ COMMITTED statements, so without serialization a rename racing a save leaves
   * rows under the old name and a re-sync racing a save archives the rows the save just made.
   * Asserted against the committed catalog state, with no settling re-sync first.
   */
  it('racing saves, renames and re-syncs always leave every project matching the catalog', async () => {
    for (let round = 0; round < 20; round++) {
      await truncateAll(db.prisma);
      const eng = await team('Eng');
      const projects = await Promise.all(
        Array.from({ length: 60 }, (_, i) => project(eng, `Client ${i}`)),
      );
      const ids = await catalog(eng, 'Payroll', 'AdHoc', 'Audit');
      const payroll = ids.get('Payroll')!;
      const adhoc = ids.get('AdHoc')!;
      const audit = ids.get('Audit')!;
      await svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng));

      // Staggered starts sweep the interleavings: each round lands the rename and the re-sync at
      // a different point inside the save's transaction.
      const later = <T>(ms: number, run: () => Promise<T>) =>
        new Promise<void>((r) => setTimeout(r, ms)).then(run);
      const results = await Promise.allSettled([
        svc().setTeamSelection(eng, { workTypeIds: [payroll, adhoc, audit] }, admin(eng)),
        later(round % 10, () => svc().update(adhoc, { name: `AdHoc ${round}` }, admin(eng))),
        later((round * 3) % 10, () => svc().resync(admin(eng))),
        later((round * 7) % 10, () => svc().update(audit, { name: `Audit ${round}` }, admin(eng))),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
      }

      const selected = await db.prisma.teamWorkType.findMany({
        where: { teamId: eng, workType: { archived: false } },
        select: { workType: { select: { id: true, name: true } } },
      });
      const want = selected.map((s) => [s.workType.id, s.workType.name]).sort();
      for (const p of projects) {
        const active = (await linked(p)).filter((r) => !r.archived);
        expect(active.map((r) => [r.workTypeId, r.name]).sort(), `round ${round}`).toEqual(want);
      }
    }
  });
});

describe('work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

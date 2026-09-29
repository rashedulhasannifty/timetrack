import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { PROJECT_PALETTE } from '@timetrack/contracts';
import { Prisma } from '@timetrack/db';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import {
  CONCURRENT_CHANGE,
  WorkTypesRepository,
} from '../src/modules/work-types/work-types.repository.js';
import { WorkTypesService } from '../src/modules/work-types/work-types.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/** The project side of team work types (spec §5, §6, §10), against a real Postgres. */
describe.runIf(RUN_E2E)('projects × work types — real Postgres', () => {
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
  const FRESHNESS = 300;
  const prisma = () => db.prisma as unknown as PrismaService;
  const projects = () =>
    new ProjectsService(
      new ProjectsRepository(prisma(), new WorkTypesRepository(prisma())),
      FRESHNESS,
    );
  const catalog = () => new WorkTypesService(new WorkTypesRepository(prisma()));
  const admin = (teamId: string): SessionUser => ({ id: ADMIN_ID, role: 'ADMIN', teamId });

  async function team(name: string): Promise<string> {
    const t = await db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
    return t.id;
  }
  /** Adds any missing names to the catalog and makes them the team's selection; name → id. */
  async function select(teamId: string, ...names: string[]): Promise<Map<string, string>> {
    const all = new Map((await catalog().list()).map((w) => [w.name, w.id] as const));
    const missing = names.filter((n) => !all.has(n));
    if (missing.length > 0) {
      const { created } = await catalog().bulkCreate({ names: missing }, admin(teamId));
      for (const w of created) all.set(w.name, w.id);
    }
    await catalog().setTeamSelection(
      teamId,
      { workTypeIds: names.map((n) => all.get(n)!) },
      admin(teamId),
    );
    return all;
  }
  function client(teamId: string, name: string) {
    return projects().createProject({ teamId, name, color: '#007aff' }, admin(teamId));
  }
  async function activeNames(projectId: string): Promise<string[]> {
    const rows = await db.prisma.subproject.findMany({
      where: { projectId, archived: false },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { name: true },
    });
    return rows.map((r) => r.name);
  }
  async function titleOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      return e instanceof HttpException ? (e.getResponse() as { title?: string }).title : undefined;
    }
  }

  it("createProject gives a new client General plus its team's work types", async () => {
    const eng = await team('Eng');
    await select(eng, 'Payroll', 'AdHoc');
    const p = await client(eng, 'Acme');

    expect(await activeNames(p.id)).toEqual(['General', 'AdHoc', 'Payroll']);
    const audit = await db.prisma.auditLog.findFirst({
      where: { action: 'work_type.reconcile', targetType: 'project', targetId: p.id },
      select: { diff: true },
    });
    expect(audit?.diff).toMatchObject({ trigger: 'project_create', projects: 1, created: 2 });
  });

  it('moving a project to another team swaps its work types, and moving back restores the same rows', async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    await select(eng, 'Payroll');
    await select(support, 'Internal');
    const p = await client(eng, 'Acme');
    const payroll = await db.prisma.subproject.findFirstOrThrow({
      where: { projectId: p.id, name: 'Payroll' },
      select: { id: true },
    });

    await projects().update(p.id, { teamId: support }, admin(eng));
    expect(await activeNames(p.id)).toEqual(['General', 'Internal']);

    await projects().update(p.id, { teamId: eng }, admin(eng));
    expect(await activeNames(p.id)).toEqual(['General', 'Payroll']);
    await expect(
      db.prisma.subproject.findFirstOrThrow({
        where: { projectId: p.id, name: 'Payroll' },
        select: { id: true, archived: true },
      }),
    ).resolves.toEqual({ id: payroll.id, archived: false });
  });

  it("bulk import creates each client with General plus the team's work types, and reports skips", async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    await select(eng, 'Payroll', 'AdHoc');
    await client(support, 'Acme Ltd');
    const old = await client(eng, 'Old Client');
    await projects().update(old.id, { archived: true }, admin(eng));

    const result = await projects().bulkCreate(
      { teamId: eng, names: ['acme ltd', 'Globex', 'old client', 'Initech', 'globex'] },
      admin(eng),
    );
    expect(result.skipped).toEqual([
      { name: 'acme ltd', reason: 'Already exists in Support' },
      { name: 'old client', reason: 'Already exists in Eng' },
      { name: 'globex', reason: 'Duplicate in list' },
    ]);
    const created = [...result.created].sort((a, b) => a.name.localeCompare(b.name));
    expect(created.map((p) => [p.name, p.teamId, p.color])).toEqual([
      ['Globex', eng, PROJECT_PALETTE[0]],
      ['Initech', eng, PROJECT_PALETTE[1]],
    ]);
    for (const p of created) {
      expect(await activeNames(p.id)).toEqual(['General', 'AdHoc', 'Payroll']);
    }

    const reconciles = await db.prisma.auditLog.findMany({
      where: { action: 'work_type.reconcile', targetType: 'team', targetId: eng },
      select: { diff: true },
    });
    expect(reconciles.map((r) => r.diff)).toContainEqual({
      trigger: 'project_bulk_create',
      projects: 2,
      created: 4,
      linked: 0,
      restored: 0,
      renamed: 0,
      archived: 0,
    });
    await expect(
      db.prisma.auditLog.count({
        where: { action: 'project.create', targetId: { in: created.map((p) => p.id) } },
      }),
    ).resolves.toBe(2);
  });

  it('bulk import 404s an unknown team and creates nothing', async () => {
    const eng = await team('Eng');
    await expect(
      projects().bulkCreate({ teamId: MISSING, names: ['Acme'] }, admin(eng)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(db.prisma.project.count()).resolves.toBe(0);
  });

  it('409s renaming or archiving a catalog-managed subproject; hand-made ones stay editable', async () => {
    const eng = await team('Eng');
    await select(eng, 'Payroll');
    const p = await client(eng, 'Acme');
    const linked = await db.prisma.subproject.findFirstOrThrow({
      where: { projectId: p.id, name: 'Payroll' },
      select: { id: true },
    });

    expect(await titleOf(projects().updateSubproject(linked.id, { name: 'Pay' }, admin(eng)))).toBe(
      'Managed by the work type catalog',
    );
    expect(
      await titleOf(projects().updateSubproject(linked.id, { archived: true }, admin(eng))),
    ).toBe('Managed by the work type catalog');

    const handMade = await projects().createSubproject(
      { projectId: p.id, name: 'Special' },
      admin(eng),
    );
    await expect(
      projects().updateSubproject(handMade.id, { archived: true }, admin(eng)),
    ).resolves.toMatchObject({ archived: true });
  });

  it('409s a new subproject whose name an active one has, case-insensitively; archived names are free', async () => {
    const eng = await team('Eng');
    await select(eng, 'Payroll');
    const p = await client(eng, 'Acme');

    await expect(
      projects().createSubproject({ projectId: p.id, name: 'PAYROLL' }, admin(eng)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      projects().createSubproject({ projectId: p.id, name: 'general' }, admin(eng)),
    ).rejects.toBeInstanceOf(ConflictException);

    const old = await projects().createSubproject({ projectId: p.id, name: 'Old' }, admin(eng));
    await projects().updateSubproject(old.id, { archived: true }, admin(eng));
    await expect(
      projects().createSubproject({ projectId: p.id, name: 'old' }, admin(eng)),
    ).resolves.toMatchObject({ name: 'old' });
  });

  it('409s renaming or restoring a hand-made subproject onto an active name, case-insensitively', async () => {
    const DUP = 'This project already has a subproject with that name';
    const eng = await team('Eng');
    await select(eng, 'Payroll');
    const p = await client(eng, 'Acme');
    const special = await projects().createSubproject(
      { projectId: p.id, name: 'Special' },
      admin(eng),
    );

    // Rename onto the linked row, onto General (trimmed, any case): refused.
    for (const name of ['payroll', ' GENERAL ']) {
      expect(await titleOf(projects().updateSubproject(special.id, { name }, admin(eng)))).toBe(
        DUP,
      );
    }
    // Its own name in another case is not a clash with itself.
    await expect(
      projects().updateSubproject(special.id, { name: 'SPECIAL' }, admin(eng)),
    ).resolves.toMatchObject({ name: 'SPECIAL' });

    // An archived row may take the name (archived names are free) but not come back with it.
    const temp = await projects().createSubproject({ projectId: p.id, name: 'Temp' }, admin(eng));
    await projects().updateSubproject(temp.id, { archived: true }, admin(eng));
    await expect(
      projects().updateSubproject(temp.id, { name: 'payroll' }, admin(eng)),
    ).resolves.toMatchObject({ name: 'payroll', archived: true });
    expect(
      await titleOf(projects().updateSubproject(temp.id, { archived: false }, admin(eng))),
    ).toBe(DUP);
    expect(await activeNames(p.id)).toEqual(['General', 'Payroll', 'SPECIAL']);
  });

  it("an EMPLOYEE sees only their team's clients, each with General plus the enabled work types", async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const ids = await select(eng, 'Payroll', 'AdHoc');
    await select(support, 'Internal');
    await client(eng, 'Acme');
    await client(support, 'Initech');
    // AdHoc is switched off for Eng afterwards: its rows archive and leave the picker.
    await catalog().setTeamSelection(eng, { workTypeIds: [ids.get('Payroll')!] }, admin(eng));

    const employee: SessionUser = {
      id: '01920000-0000-7000-8000-0000000000e1',
      role: 'EMPLOYEE',
      teamId: eng,
    };
    // Naming another team does not widen an EMPLOYEE's scope.
    const list = await projects().list(employee, false, support);
    expect(list.map((p) => p.name)).toEqual(['Acme']);
    const subs = list[0]?.subprojects ?? [];
    expect(subs.map((s) => s.name)).toEqual(['General', 'Payroll']);
    // The /v1 shape the shipped clients read is unchanged: no workTypeId on the wire.
    for (const s of subs) {
      expect(Object.keys(s).sort()).toEqual(['archived', 'id', 'isDefault', 'name', 'projectId']);
    }
  });

  it('maps a unique violation from the reconcile to a 409, never a raw error (R9)', async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const p = await client(eng, 'Acme');
    const clash = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const failing = {
      reconcile: () => Promise.reject(clash),
    } as unknown as WorkTypesRepository;
    const repo = new ProjectsRepository(prisma(), failing);

    await expect(repo.createProject(eng, 'Globex', ADMIN_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(repo.setTeam(p.id, support, ADMIN_ID)).rejects.toBeInstanceOf(ConflictException);
    // Both transactions rolled back.
    await expect(db.prisma.project.count({ where: { name: 'Globex' } })).resolves.toBe(0);
    await expect(
      db.prisma.project.findUniqueOrThrow({ where: { id: p.id }, select: { teamId: true } }),
    ).resolves.toEqual({ teamId: eng });
  });

  it('maps a deadlock or serialization failure (P2034) in the reconcile to the concurrent-change 409', async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const p = await client(eng, 'Acme');
    const deadlock = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const failing = {
      reconcile: () => Promise.reject(deadlock),
    } as unknown as WorkTypesRepository;
    const repo = new ProjectsRepository(prisma(), failing);

    for (const attempt of [
      () => repo.createProject(eng, 'Globex', ADMIN_ID),
      () => repo.createProjectsBulk(eng, [{ name: 'Initech', color: '#007aff' }], ADMIN_ID),
      () => repo.setTeam(p.id, support, ADMIN_ID),
    ]) {
      expect(await titleOf(attempt())).toBe(CONCURRENT_CHANGE);
    }
  });

  it('409s a duplicate subproject name that only differs by surrounding whitespace', async () => {
    const eng = await team('Eng');
    await select(eng, 'Payroll');
    const p = await client(eng, 'Acme');
    await expect(
      projects().createSubproject({ projectId: p.id, name: 'Payroll ' }, admin(eng)),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('projects × work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

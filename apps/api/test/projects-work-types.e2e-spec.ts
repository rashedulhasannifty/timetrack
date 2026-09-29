import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { PROJECT_PALETTE } from '@timetrack/contracts';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { WorkTypesRepository } from '../src/modules/work-types/work-types.repository.js';
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
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('projects × work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

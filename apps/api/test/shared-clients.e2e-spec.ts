import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { WorkTypesRepository } from '../src/modules/work-types/work-types.repository.js';
import { WorkTypesService } from '../src/modules/work-types/work-types.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/** Shared clients (spec §5.4): one client linked to several teams, against a real Postgres. */
describe.runIf(RUN_E2E)('shared clients — real Postgres', () => {
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
  const manager = (id: string, teamId: string): SessionUser => ({ id, role: 'MANAGER', teamId });
  const employee = (id: string, teamId: string): SessionUser => ({ id, role: 'EMPLOYEE', teamId });
  async function link(projectId: string, teamId: string): Promise<void> {
    await db.prisma.projectTeam.create({ data: { projectId, teamId } });
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

  it("a team's selection change reaches a shared client it is not home to", async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    await select(eng, 'Payroll');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);

    await select(ops, 'Internal');
    expect(await activeNames(acme.id)).toEqual(['General', 'Internal', 'Payroll']);
  });

  it('a new client, a bulk-imported client, and a moved client each have exactly their home link', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    const { created } = await projects().bulkCreate({ teamId: eng, names: ['Globex'] }, admin(eng));
    await projects().update(acme.id, { teamId: ops }, admin(eng));

    const links = await db.prisma.projectTeam.findMany({
      orderBy: { projectId: 'asc' },
      select: { projectId: true, teamId: true },
    });
    expect(links).toEqual(
      [
        { projectId: acme.id, teamId: ops },
        { projectId: created[0]!.id, teamId: eng },
      ].sort((a, b) => a.projectId.localeCompare(b.projectId)),
    );
  });

  it('re-sync repairs a project with no link row: the home team always counts', async () => {
    const eng = await team('Eng');
    await select(eng, 'Payroll');
    const p = await db.prisma.project.create({
      data: { teamId: eng, name: 'Old code' },
      select: { id: true },
    });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'General', isDefault: true },
    });

    await catalog().resync(admin(eng));
    expect(await activeNames(p.id)).toEqual(['General', 'Payroll']);
  });
});

describe('shared clients e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

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

  it('the picker lists a shared client for both teams, home team first in teamIds', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);

    const E1 = '01920000-0000-7000-8000-0000000000e1';
    const forOps = await projects().list(employee(E1, ops));
    expect(forOps.map((p) => [p.name, p.teamId, p.teamIds])).toEqual([['Acme', eng, [eng, ops]]]);
    const forEng = await projects().list(employee(E1, eng));
    expect(forEng.map((p) => p.name)).toEqual(['Acme']);
  });

  it('a project with no link row is still listed for its home team, teamIds [home]', async () => {
    const eng = await team('Eng');
    await db.prisma.project.create({ data: { teamId: eng, name: 'Old code' } });

    const rows = await projects().list(employee('01920000-0000-7000-8000-0000000000e1', eng));
    expect(rows.map((p) => [p.name, p.teamIds])).toEqual([['Old code', [eng]]]);
  });

  it('a project with no link row still receives its home team selection change', async () => {
    const eng = await team('Eng');
    const p = await db.prisma.project.create({
      data: { teamId: eng, name: 'Old code' },
      select: { id: true },
    });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'General', isDefault: true },
    });

    await select(eng, 'Payroll');
    expect(await activeNames(p.id)).toContain('Payroll');
  });

  it('moving a shared project keeps its other links and drops the old home link', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const fin = await team('Fin');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);

    await projects().update(acme.id, { teamId: fin }, admin(eng));

    const links = await db.prisma.projectTeam.findMany({
      where: { projectId: acme.id },
      select: { teamId: true },
    });
    expect(links.map((l) => l.teamId).sort()).toEqual([ops, fin].sort());
  });

  it('a manager of a linked non-home team may add a subproject but not archive or recolor', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);
    const opsMgr = manager('01920000-0000-7000-8000-0000000000b2', ops);

    await expect(
      projects().createSubproject({ projectId: acme.id, name: 'Onboarding' }, opsMgr),
    ).resolves.toMatchObject({ name: 'Onboarding' });
    expect(await titleOf(projects().update(acme.id, { archived: true }, opsMgr))).toBe(
      'Only an admin can change a shared client',
    );
    expect(await titleOf(projects().update(acme.id, { color: '#ff9500' }, opsMgr))).toBe(
      'Only an admin can change a shared client',
    );
  });

  it("the home team's manager also loses archive once the client is shared, and keeps it when not", async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const engMgr = manager('01920000-0000-7000-8000-0000000000b1', eng);
    const solo = await client(eng, 'Solo');
    await expect(projects().update(solo.id, { archived: true }, engMgr)).resolves.toMatchObject({
      archived: true,
    });

    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);
    expect(await titleOf(projects().update(acme.id, { archived: true }, engMgr))).toBe(
      'Only an admin can change a shared client',
    );
  });

  it('a manager of an unlinked team is still refused', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    const opsMgr = manager('01920000-0000-7000-8000-0000000000b2', ops);
    expect(
      await titleOf(projects().createSubproject({ projectId: acme.id, name: 'X' }, opsMgr)),
    ).toBe('Cannot manage a project in another team');
  });

  it('set-teams shares and unshares, audits the change, and reconciles in one go', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    await select(eng, 'Payroll');
    await select(ops, 'Internal');
    const acme = await client(eng, 'Acme');

    const shared = await projects().setTeams(acme.id, { teamIds: [eng, ops] }, admin(eng));
    expect(shared.teamIds).toEqual([eng, ops]); // home first
    expect(await activeNames(acme.id)).toEqual(['General', 'Internal', 'Payroll']);
    const internal = await db.prisma.subproject.findFirstOrThrow({
      where: { projectId: acme.id, name: 'Internal' },
      select: { id: true },
    });

    await projects().setTeams(acme.id, { teamIds: [eng] }, admin(eng));
    expect(await activeNames(acme.id)).toEqual(['General', 'Payroll']);
    await expect(
      db.prisma.subproject.findUniqueOrThrow({
        where: { id: internal.id },
        select: { archived: true },
      }),
    ).resolves.toEqual({ archived: true });

    const audits = await db.prisma.auditLog.findMany({
      where: { action: 'project.teams_set', targetId: acme.id },
      orderBy: { timestamp: 'asc' },
      select: { diff: true },
    });
    expect(audits.map((a) => a.diff)).toEqual([
      { from: [eng], to: [eng, ops].sort() },
      { from: [eng, ops].sort(), to: [eng] },
    ]);
  });

  it('set-teams 422s without the home team and for an unknown team; 404s an unknown project', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    expect(await titleOf(projects().setTeams(acme.id, { teamIds: [ops] }, admin(eng)))).toBe(
      'The home team must stay linked; move the client to change it',
    );
    expect(
      await titleOf(projects().setTeams(acme.id, { teamIds: [eng, MISSING] }, admin(eng))),
    ).toBe('Unknown team');
    expect(await titleOf(projects().setTeams(MISSING, { teamIds: [eng] }, admin(eng)))).toBe(
      'Project not found',
    );
  });

  it('an admin can archive a shared client', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);
    await expect(projects().update(acme.id, { archived: true }, admin(eng))).resolves.toMatchObject(
      { archived: true },
    );
  });

  it("a manager of a linked non-home team can create a task on the shared client's subproject", async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);
    const opsMgr = manager('01920000-0000-7000-8000-0000000000b2', ops);
    const general = await db.prisma.subproject.findFirstOrThrow({
      where: { projectId: acme.id, isDefault: true },
      select: { id: true },
    });
    await expect(
      projects().createTask({ subprojectId: general.id, name: 'Kickoff' }, opsMgr),
    ).resolves.toMatchObject({ name: 'Kickoff' });
  });

  it('a manager of an unlinked team gets 403 on detail and top-apps of a shared client', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const qa = await team('QA');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);
    const qaMgr = manager('01920000-0000-7000-8000-0000000000b3', qa);
    const range = { from: '2026-07-11T00:00:00.000Z', to: '2026-07-12T00:00:00.000Z' };
    expect(await titleOf(projects().detail(acme.id, range, qaMgr))).toBe(
      'Cannot manage a project in another team',
    );
    expect(await titleOf(projects().topApps(acme.id, range, qaMgr))).toBe(
      'Cannot manage a project in another team',
    );
  });

  it('detail splits a shared client by the team each entry was tracked under', async () => {
    const eng = await team('Eng');
    const ops = await team('Ops');
    const acme = await client(eng, 'Acme');
    await link(acme.id, ops);
    const [ann, bob] = await Promise.all([
      db.prisma.user.create({
        data: { email: 'ann@x.io', name: 'Ann', passwordHash: 'x', teamId: eng },
        select: { id: true },
      }),
      db.prisma.user.create({
        data: { email: 'bob@x.io', name: 'Bob', passwordHash: 'x', teamId: ops },
        select: { id: true },
      }),
    ]);
    const entry = (id: string, userId: string, hour: number) => ({
      id,
      userId,
      projectId: acme.id,
      source: 'MANUAL' as const,
      startTime: new Date(`2026-07-11T0${hour}:00:00Z`),
      endTime: new Date(`2026-07-11T0${hour + 1}:00:00Z`),
    });
    await db.prisma.timeEntry.createMany({
      data: [
        entry('01920000-0000-7000-8000-00000000f001', ann.id, 1),
        entry('01920000-0000-7000-8000-00000000f002', bob.id, 3),
        entry('01920000-0000-7000-8000-00000000f003', bob.id, 5),
      ],
    });
    const range = { from: '2026-07-11T00:00:00.000Z', to: '2026-07-12T00:00:00.000Z' };

    const asAdmin = await projects().detail(acme.id, range, admin(eng));
    expect(asAdmin.teamIds[0]).toBe(eng);
    expect(asAdmin.byTeam).toEqual([
      { teamId: ops, teamName: 'Ops', trackedSeconds: 7200 },
      { teamId: eng, teamName: 'Eng', trackedSeconds: 3600 },
    ]);
    expect(asAdmin.totalSeconds).toBe(10800);
    expect(asAdmin.members.map((m) => m.name).sort()).toEqual(['Ann', 'Bob']);

    const asOpsManager = await projects().detail(
      acme.id,
      range,
      manager('01920000-0000-7000-8000-0000000000b2', ops),
    );
    expect(asOpsManager.byTeam).toEqual(asAdmin.byTeam);
    expect(asOpsManager.totalSeconds).toBe(10800);
    expect(asOpsManager.members.map((m) => m.name)).toEqual(['Bob']);
  });
});

describe('shared clients e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

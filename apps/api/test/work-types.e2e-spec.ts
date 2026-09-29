import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

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
describe('work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

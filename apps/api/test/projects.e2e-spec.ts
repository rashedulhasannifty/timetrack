import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('projects repository — real Postgres', () => {
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

  function repo(): ProjectsRepository {
    return new ProjectsRepository(db.prisma as unknown as PrismaService);
  }

  async function seedTeam(name = 'Eng') {
    return db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
  }

  /** The project's default ("General") subproject — createProject makes exactly one. */
  async function generalOf(projectId: string): Promise<string> {
    const s = await db.prisma.subproject.findFirstOrThrow({
      where: { projectId, isDefault: true },
      select: { id: true },
    });
    return s.id;
  }

  it('createProject inserts the project and writes an audit row', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');

    expect(project).toMatchObject({ teamId: team.id, name: 'Website', archived: false });
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'project', targetId: project.id },
    });
    expect(audit?.action).toBe('project.create');
  });

  it('createTask inserts the task and writes an audit row', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(await generalOf(project.id), 'Homepage', 'actor1');

    expect(task).toMatchObject({ projectId: project.id, name: 'Homepage' });
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'task', targetId: task.id },
    });
    expect(audit?.action).toBe('task.create');
  });

  it('setTaskArchived toggles archived and audits archive vs unarchive', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(await generalOf(project.id), 'Homepage', 'actor1');

    const archived = await repo().setTaskArchived(task.id, true, 'actor1');
    expect(archived.archived).toBe(true);
    const unarchived = await repo().setTaskArchived(task.id, false, 'actor1');
    expect(unarchived.archived).toBe(false);

    const actions = await db.prisma.auditLog.findMany({
      where: { targetType: 'task', targetId: task.id },
      orderBy: { timestamp: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(['task.create', 'task.archive', 'task.unarchive']);
  });

  it('listByTeam nested tasks exclude archived; listTasksForProject includes them', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const active = await repo().createTask(await generalOf(project.id), 'Active', 'actor1');
    const gone = await repo().createTask(await generalOf(project.id), 'Old', 'actor1');
    await repo().setTaskArchived(gone.id, true, 'actor1');

    const listed = await repo().listByTeam(team.id, true);
    const nestedTaskIds = (listed[0]?.tasks ?? []).map((t) => t.id);
    expect(nestedTaskIds).toEqual([active.id]); // archived filtered from assignment list

    const all = await repo().listTasksForProject(project.id);
    expect(all.map((t) => t.id).sort()).toEqual([active.id, gone.id].sort());
    // active-first ordering: the non-archived task precedes the archived one
    expect(all[0]?.id).toBe(active.id);
  });

  it('findTaskForActor returns the task with its teamId, or null when missing', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(await generalOf(project.id), 'Homepage', 'actor1');
    expect(await repo().findTaskForActor(task.id)).toEqual({
      id: task.id,
      projectId: project.id,
      subprojectId: await generalOf(project.id),
      name: 'Homepage',
      archived: false,
      teamId: team.id,
    });
    expect(await repo().findTaskForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('listByTeam excludes archived by default and includes them when asked', async () => {
    const team = await seedTeam();
    const active = await repo().createProject(team.id, 'Active', 'actor1');
    const archivedProject = await repo().createProject(team.id, 'Old', 'actor1');
    await repo().setArchived(archivedProject.id, true, 'actor1');

    const assignable = await repo().listByTeam(team.id);
    expect(assignable.map((p) => p.id)).toEqual([active.id]);

    const all = await repo().listByTeam(team.id, true);
    expect(all.map((p) => p.id).sort()).toEqual([active.id, archivedProject.id].sort());
  });

  it('listByTeam returns projects ordered by name asc', async () => {
    const team = await seedTeam();
    // Insert out of alphabetical order; the repo must return them name-sorted.
    await repo().createProject(team.id, 'Zeta', 'actor1');
    await repo().createProject(team.id, 'Alpha', 'actor1');
    await repo().createProject(team.id, 'Mango', 'actor1');

    const names = (await repo().listByTeam(team.id)).map((p) => p.name);
    expect(names).toEqual(['Alpha', 'Mango', 'Zeta']);
  });

  it('setArchived toggles archived and audits archive vs unarchive', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');

    const archived = await repo().setArchived(project.id, true, 'actor1');
    expect(archived.archived).toBe(true);
    const unarchived = await repo().setArchived(project.id, false, 'actor1');
    expect(unarchived.archived).toBe(false);

    const actions = await db.prisma.auditLog.findMany({
      where: { targetType: 'project', targetId: project.id },
      orderBy: { timestamp: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'project.create',
      'project.archive',
      'project.unarchive',
    ]);
  });

  it('findForActor returns id/teamId/name/archived, or null when missing', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    expect(await repo().findForActor(project.id)).toEqual({
      id: project.id,
      teamId: team.id,
      name: 'Website',
      color: null,
      archived: false,
    });
    expect(await repo().findForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('createProject persists a color and records it in the audit diff', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1', '#5e5ce6');
    expect(project.color).toBe('#5e5ce6');
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'project', targetId: project.id, action: 'project.create' },
    });
    expect((audit?.diff as { color?: string } | null)?.color).toBe('#5e5ce6');
  });

  it('createProject defaults color to null when omitted', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    expect(project.color).toBeNull();
  });

  it('setColor updates the color and writes a project.recolor audit row', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const recolored = await repo().setColor(project.id, '#ff2d55', 'actor1');
    expect(recolored.color).toBe('#ff2d55');
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'project', targetId: project.id, action: 'project.recolor' },
    });
    expect((audit?.diff as { color?: string } | null)?.color).toBe('#ff2d55');
  });

  async function seedUser(teamId: string, name: string, email: string) {
    return db.prisma.user.create({
      data: { email, name, passwordHash: 'x', teamId },
      select: { id: true },
    });
  }
  async function seedEntry(
    userId: string,
    projectId: string,
    taskId: string | null,
    startIso: string,
    endIso: string,
  ) {
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        projectId,
        taskId,
        startTime: new Date(startIso),
        endTime: new Date(endIso),
        source: 'MANUAL',
      },
    });
  }

  const FROM = new Date('2026-07-13T00:00:00.000Z');
  const TO = new Date('2026-07-20T00:00:00.000Z');
  // TRACKING_FRESHNESS_SECONDS' default (packages/config). ProjectsService threads the injected
  // value down; the repository takes it as a parameter so a spec can state the window it asserts.
  const FRESHNESS = 300;

  /** A STRANDED open entry: started, never stopped, client no longer heartbeating. */
  async function seedStranded(
    userId: string,
    projectId: string,
    taskId: string | null,
    startIso: string,
    heartbeatIso: string | null,
  ) {
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        projectId,
        taskId,
        startTime: new Date(startIso),
        endTime: null,
        heartbeatAt: heartbeatIso === null ? null : new Date(heartbeatIso),
        source: 'MANUAL',
      },
    });
  }

  it('membersForProject sums per user, descending, with names', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const john = await seedUser(team.id, 'John', 'john@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h
    await seedEntry(john.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h
    const rows = await repo().membersForProject(project.id, FROM, TO, FRESHNESS);
    expect(rows).toEqual([
      { userId: jane.id, name: 'Jane', trackedSeconds: 7200 },
      { userId: john.id, name: 'John', trackedSeconds: 3600 },
    ]);
  });

  it('membersForProject excludes a member whose only entry is zero-duration (no phantom row)', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const ghost = await seedUser(team.id, 'Ghost', 'ghost@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h
    // Ghost's ONLY entry is a discarded recovery span (spec §4.4, Task 7's Discard path).
    await seedEntry(ghost.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T09:00:00Z');
    const rows = await repo().membersForProject(project.id, FROM, TO, FRESHNESS);
    // Without the fix, Ghost would appear as a phantom { trackedSeconds: 0 } row.
    expect(rows).toEqual([{ userId: jane.id, name: 'Jane', trackedSeconds: 7200 }]);
  });

  it('membersForProject still includes a genuinely open entry (the critical property)', async () => {
    const team = await seedTeam();
    const cy = await seedUser(team.id, 'Cy', 'cy@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId: cy.id,
        projectId: project.id,
        taskId: null,
        source: 'AUTO',
        startTime: new Date(Date.now() - 30 * 60 * 1000),
        endTime: null,
      },
    });
    const rows = await repo().membersForProject(project.id, from, to, FRESHNESS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: cy.id, name: 'Cy' });
    expect(rows[0]?.trackedSeconds).toBeGreaterThan(0);
  });

  it('tasksForProject buckets by task and rolls null taskId into "No task"', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(await generalOf(project.id), 'Homepage', 'actor1');
    await seedEntry(jane.id, project.id, task.id, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h Homepage
    await seedEntry(jane.id, project.id, null, '2026-07-14T13:00:00Z', '2026-07-14T13:30:00Z'); // 30m No task
    const rows = await repo().tasksForProject(project.id, FROM, TO, FRESHNESS);
    const general = await generalOf(project.id);
    expect(rows).toEqual([
      { taskId: task.id, subprojectId: general, name: 'Homepage', trackedSeconds: 7200 },
      { taskId: null, subprojectId: null, name: 'No task', trackedSeconds: 1800 },
    ]);
  });

  it('subprojectsForProject buckets by subproject and rolls null into "No subproject"', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const general = await generalOf(project.id);
    const closed = (start: string, end: string, subprojectId: string | null) =>
      db.prisma.timeEntry.create({
        data: {
          id: crypto.randomUUID(),
          userId: jane.id,
          projectId: project.id,
          taskId: null,
          subprojectId,
          source: 'MANUAL',
          startTime: new Date(start),
          endTime: new Date(end),
        },
      });
    await closed('2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z', general); // 1h General
    await closed('2026-07-14T13:00:00Z', '2026-07-14T13:30:00Z', null); // 30m, unresolved
    const rows = await repo().subprojectsForProject(project.id, FROM, TO, FRESHNESS);
    expect(rows).toEqual([
      { subprojectId: general, name: 'General', trackedSeconds: 3600 },
      { subprojectId: null, name: 'No subproject', trackedSeconds: 1800 },
    ]);
  });

  it('tasksForProject excludes a task whose only entry is zero-duration (no phantom row)', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(await generalOf(project.id), 'Homepage', 'actor1');
    const ghostTask = await repo().createTask(await generalOf(project.id), 'Ghost task', 'actor1');
    await seedEntry(jane.id, project.id, task.id, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h
    // "Ghost task"'s ONLY entry is a discarded recovery span (spec §4.4, Task 7's Discard path).
    await seedEntry(
      jane.id,
      project.id,
      ghostTask.id,
      '2026-07-14T13:00:00Z',
      '2026-07-14T13:00:00Z',
    );
    const rows = await repo().tasksForProject(project.id, FROM, TO, FRESHNESS);
    // Without the fix, "Ghost task" would appear as a phantom { trackedSeconds: 0 } row.
    expect(rows).toEqual([
      {
        taskId: task.id,
        subprojectId: await generalOf(project.id),
        name: 'Homepage',
        trackedSeconds: 7200,
      },
    ]);
  });

  it('tasksForProject still includes a genuinely open entry (the critical property)', async () => {
    const team = await seedTeam();
    const cy = await seedUser(team.id, 'Cy', 'cy@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(await generalOf(project.id), 'Homepage', 'actor1');
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId: cy.id,
        projectId: project.id,
        taskId: task.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 30 * 60 * 1000),
        endTime: null,
      },
    });
    const rows = await repo().tasksForProject(project.id, from, to, FRESHNESS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: task.id, name: 'Homepage' });
    expect(rows[0]?.trackedSeconds).toBeGreaterThan(0);
  });

  it('hoursByDay buckets by Dhaka start-day and clamps to the window', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h on 14th
    await seedEntry(jane.id, project.id, null, '2026-07-15T09:00:00Z', '2026-07-15T11:00:00Z'); // 2h on 15th
    // An entry starting before the window: clamped to FROM, bucketed on the window's first day.
    await seedEntry(jane.id, project.id, null, '2026-07-12T23:00:00Z', '2026-07-13T01:00:00Z'); // 1h inside window
    const rows = await repo().hoursByDay(project.id, FROM, TO, FRESHNESS);
    expect(rows).toEqual([
      { day: '2026-07-13', trackedSeconds: 3600 },
      { day: '2026-07-14', trackedSeconds: 3600 },
      { day: '2026-07-15', trackedSeconds: 7200 },
    ]);
  });

  it('hoursByDay labels a bucket by the Dhaka start-day, not the UTC one', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    // 01:00-02:00 Dhaka on 2026-08-20 — which is 19:00-20:00Z on 2026-08-19. `to_char` on the
    // clamped start is the only day derivation in this query, so this is its boundary case.
    await seedEntry(jane.id, project.id, null, '2026-08-19T19:00:00Z', '2026-08-19T20:00:00Z');

    const rows = await repo().hoursByDay(
      project.id,
      new Date('2026-08-19T00:00:00.000Z'),
      new Date('2026-08-21T00:00:00.000Z'),
      FRESHNESS,
    );

    // Under UTC the bucket would be labelled 2026-08-19.
    expect(rows).toEqual([{ day: '2026-08-20', trackedSeconds: 3600 }]);
  });

  it('hoursByDay excludes a zero-duration (discarded recovery) entry — no phantom day row', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    // A discarded recovery span, alone on its day: closed at its own start (spec §4.4).
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId: jane.id,
        projectId: project.id,
        taskId: null,
        startTime: new Date('2026-07-16T09:00:00Z'),
        endTime: new Date('2026-07-16T09:00:00Z'),
        source: 'MANUAL',
      },
    });
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h on 14th
    const rows = await repo().hoursByDay(project.id, FROM, TO, FRESHNESS);
    // Without the fix, the 16th would appear as a phantom { day: '2026-07-16', trackedSeconds: 0 } row.
    expect(rows).toEqual([{ day: '2026-07-14', trackedSeconds: 3600 }]);
  });

  it('aggregations return empty for a project with no entries in range', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Empty', 'actor1');
    expect(await repo().membersForProject(project.id, FROM, TO, FRESHNESS)).toEqual([]);
    expect(await repo().tasksForProject(project.id, FROM, TO, FRESHNESS)).toEqual([]);
    expect(await repo().hoursByDay(project.id, FROM, TO, FRESHNESS)).toEqual([]);
  });

  async function seedSample(
    userId: string,
    appName: string,
    timestampIso: string,
    activityPct = 50,
  ) {
    await db.prisma.activitySample.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        timestamp: new Date(timestampIso),
        appName,
        windowTitle: null,
        activityPct,
        category: 'NEUTRAL',
      },
    });
  }

  it('bounds a stranded open entry the same way /reports does, in every project aggregate', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    // Started 09:00, last heartbeat 09:03, then the Mac went away. Unclamped, every aggregate
    // below reports TO - startTime (5d15h) and grows every day the row stays open — while
    // /reports shows the same entry bounded at 480s. One entry, two pages, two numbers.
    await seedStranded(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T09:03:00Z');

    const bounded = 3 * 60 + FRESHNESS; // 480

    expect(await repo().membersForProject(project.id, FROM, TO, FRESHNESS)).toEqual([
      { userId: jane.id, name: 'Jane', trackedSeconds: bounded },
    ]);
    expect(await repo().tasksForProject(project.id, FROM, TO, FRESHNESS)).toEqual([
      { taskId: null, subprojectId: null, name: 'No task', trackedSeconds: bounded },
    ]);
    expect(await repo().hoursByDay(project.id, FROM, TO, FRESHNESS)).toEqual([
      { day: '2026-07-14', trackedSeconds: bounded },
    ]);
    expect((await repo().topAppsForProject(project.id, FROM, TO, FRESHNESS)).totalSeconds).toBe(
      bounded,
    );
  });

  it('falls back to startTime for an entry written before heartbeatAt existed', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedStranded(jane.id, project.id, null, '2026-07-14T09:00:00Z', null);

    expect(await repo().membersForProject(project.id, FROM, TO, FRESHNESS)).toEqual([
      { userId: jane.id, name: 'Jane', trackedSeconds: FRESHNESS },
    ]);
  });

  it('topAppsForProject: a stranded entry does not claim coverage past its freshness window', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedStranded(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T09:03:00Z');
    // Inside the clamped span [09:00, 09:08) — genuinely covered by the entry.
    await seedSample(jane.id, 'Chrome', '2026-07-14T09:01:00Z');
    // Hours later. The user was not tracking this project any more; only an unclamped
    // `COALESCE(endTime, now())` would sweep it in and inflate coveredSeconds.
    await seedSample(jane.id, 'Slack', '2026-07-14T12:00:00Z');

    const result = await repo().topAppsForProject(project.id, FROM, TO, FRESHNESS);
    expect(result.apps).toEqual([{ appName: 'Chrome', trackedSeconds: 60 }]);
  });

  it('topAppsForProject: MANUAL entry with no samples is a real, measurable gap', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');

    // AUTO entry, 09:00-09:10 (10 min), with a matching sample every minute in 2 apps.
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId: jane.id,
        projectId: project.id,
        taskId: null,
        startTime: new Date('2026-07-14T09:00:00Z'),
        endTime: new Date('2026-07-14T09:10:00Z'),
        source: 'AUTO',
      },
    });
    for (let m = 0; m < 6; m++) {
      await seedSample(jane.id, 'Chrome', `2026-07-14T09:0${m}:00Z`);
    }
    for (let m = 6; m < 10; m++) {
      await seedSample(jane.id, 'VS Code', `2026-07-14T09:0${m}:00Z`);
    }

    // MANUAL entry, 30 min, no samples at all — a real gap (e.g. offline/manually logged work).
    await seedEntry(jane.id, project.id, null, '2026-07-14T13:00:00Z', '2026-07-14T13:30:00Z');

    const result = await repo().topAppsForProject(project.id, FROM, TO, FRESHNESS);

    expect(result.apps).toEqual([
      { appName: 'Chrome', trackedSeconds: 360 },
      { appName: 'VS Code', trackedSeconds: 240 },
    ]);
    expect(result.totalSeconds).toBe(10 * 60 + 30 * 60); // AUTO 10min + MANUAL 30min

    const coveredSeconds = result.apps.reduce((sum, a) => sum + a.trackedSeconds, 0);
    expect(coveredSeconds).toBeLessThan(result.totalSeconds); // the MANUAL gap is real
  });

  it('topAppsForProject: overlapping same-project entries count each sample once', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');

    // Two overlapping entries for the same user+project both spanning 09:00-09:10.
    // Nothing forbids overlap (only one-running-per-user is enforced) — e.g. a retroactive
    // MANUAL correction laid on top of an AUTO span.
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId: jane.id,
        projectId: project.id,
        taskId: null,
        startTime: new Date('2026-07-14T09:00:00Z'),
        endTime: new Date('2026-07-14T09:10:00Z'),
        source: 'AUTO',
      },
    });
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T09:10:00Z');

    // Samples land in the overlap: a plain JOIN would double them (once per entry).
    for (let m = 0; m < 10; m++) {
      await seedSample(jane.id, 'Chrome', `2026-07-14T09:0${m}:00Z`);
    }

    const result = await repo().topAppsForProject(project.id, FROM, TO, FRESHNESS);

    // Each of the 10 samples counted exactly once, not twice.
    expect(result.apps).toEqual([{ appName: 'Chrome', trackedSeconds: 600 }]);
    expect(result.totalSeconds).toBe(20 * 60); // two 10-min entries, summed independently

    const coveredSeconds = result.apps.reduce((sum, a) => sum + a.trackedSeconds, 0);
    expect(coveredSeconds).toBeLessThanOrEqual(result.totalSeconds);
  });

  describe('setTeam — recovering a project stranded by a team change', () => {
    it('moves the project and audits the from/to in the same transaction', async () => {
      const eng = await seedTeam('Engineering');
      const support = await seedTeam('Support');
      const project = await repo().createProject(eng.id, 'Apollo', 'admin-1');

      const moved = await repo().setTeam(project.id, support.id, 'admin-1');
      expect(moved.teamId).toBe(support.id);

      // It is now assignable in Support and gone from Engineering — the whole point.
      await expect(repo().listByTeam(support.id)).resolves.toHaveLength(1);
      await expect(repo().listByTeam(eng.id)).resolves.toHaveLength(0);

      const audit = await db.prisma.auditLog.findMany({
        where: { targetId: project.id, action: 'project.team_change' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff).toEqual({ from: eng.id, to: support.id });
      expect(audit[0]!.actorId).toBe('admin-1');
    });

    it('carries the project’s tasks with it', async () => {
      const eng = await seedTeam('Engineering');
      const support = await seedTeam('Support');
      const project = await repo().createProject(eng.id, 'Apollo', 'admin-1');
      await repo().createTask(await generalOf(project.id), 'Design', 'admin-1');

      await repo().setTeam(project.id, support.id, 'admin-1');

      // Tasks hang off the project by FK, so they follow without being touched.
      await expect(repo().listTasksForProject(project.id)).resolves.toHaveLength(1);
    });

    it('leaves the name, color and archived flag alone', async () => {
      const eng = await seedTeam('Engineering');
      const support = await seedTeam('Support');
      const project = await repo().createProject(eng.id, 'Apollo', 'admin-1', '#ff0000');
      await repo().setArchived(project.id, true, 'admin-1');

      const moved = await repo().setTeam(project.id, support.id, 'admin-1');
      expect(moved.name).toBe('Apollo');
      expect(moved.color).toBe('#ff0000');
      expect(moved.archived).toBe(true);
    });
  });

  describe('subprojects', () => {
    it('createProject also creates exactly one default "General" subproject', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const subs = await repo().listSubprojectsForProject(project.id);
      expect(subs).toEqual([
        expect.objectContaining({
          projectId: project.id,
          name: 'General',
          isDefault: true,
          archived: false,
        }),
      ]);
    });

    it('the partial index refuses a second default for one project', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      await expect(
        db.prisma.subproject.create({
          data: { projectId: project.id, name: 'Dup', isDefault: true },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('createSubproject inserts and audits', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
      expect(sub).toMatchObject({
        projectId: project.id,
        name: 'Checkout',
        isDefault: false,
        archived: false,
      });
      const audit = await db.prisma.auditLog.findFirst({
        where: { targetType: 'subproject', targetId: sub.id },
      });
      expect(audit?.action).toBe('subproject.create');
    });

    it('updateSubproject renames/archives and audits the patch', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
      const updated = await repo().updateSubproject(
        sub.id,
        { name: 'Payments', archived: true },
        'actor1',
      );
      expect(updated).toMatchObject({ name: 'Payments', archived: true });
      const audit = await db.prisma.auditLog.findFirst({
        where: { targetType: 'subproject', targetId: sub.id, action: 'subproject.update' },
      });
      expect(audit?.diff).toEqual({ name: 'Payments', archived: true });
    });

    it('listSubprojectsForProject orders default first, then active, then by name', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const z = await repo().createSubproject(project.id, 'Zeta', 'actor1');
      await repo().createSubproject(project.id, 'Alpha', 'actor1');
      await repo().updateSubproject(z.id, { archived: true }, 'actor1');
      await repo().createSubproject(project.id, 'Beta', 'actor1');
      const names = (await repo().listSubprojectsForProject(project.id)).map((s) => s.name);
      expect(names).toEqual(['General', 'Alpha', 'Beta', 'Zeta']);
    });

    it('findSubprojectForActor returns the subproject with its team, or null', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
      expect(await repo().findSubprojectForActor(sub.id)).toEqual({ ...sub, teamId: team.id });
      expect(
        await repo().findSubprojectForActor('019797a0-0000-7000-8000-0000000000ff'),
      ).toBeNull();
    });

    it('createTask derives projectId from the subproject', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
      const task = await repo().createTask(sub.id, 'Pay form', 'actor1');
      expect(task).toMatchObject({
        projectId: project.id,
        subprojectId: sub.id,
        name: 'Pay form',
      });
    });

    it('moveTask changes the subproject and audits from/to', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const general = await generalOf(project.id);
      const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
      const task = await repo().createTask(general, 'Pay form', 'actor1');
      const moved = await repo().moveTask(task.id, sub.id, 'actor1');
      expect(moved.subprojectId).toBe(sub.id);
      const audit = await db.prisma.auditLog.findFirst({
        where: { targetId: task.id, action: 'task.move' },
      });
      expect(audit?.diff).toEqual({ from: general, to: sub.id });
    });

    it('listByTeam returns subprojects and hides tasks of archived subprojects', async () => {
      const team = await seedTeam();
      const project = await repo().createProject(team.id, 'Website', 'actor1');
      const general = await generalOf(project.id);
      const old = await repo().createSubproject(project.id, 'Old', 'actor1');
      const kept = await repo().createTask(general, 'Kept', 'actor1');
      await repo().createTask(old.id, 'Hidden', 'actor1');
      await repo().updateSubproject(old.id, { archived: true }, 'actor1');

      const [active] = await repo().listByTeam(team.id);
      expect(active?.tasks?.map((t) => t.id)).toEqual([kept.id]);
      expect(active?.subprojects?.map((s) => s.name)).toEqual(['General']);

      const [all] = await repo().listByTeam(team.id, true);
      expect(all?.subprojects?.map((s) => s.name)).toEqual(['General', 'Old']);
      expect(all?.tasks?.map((t) => t.id)).toEqual([kept.id]); // still hidden: not assignable
    });
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('projects e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});

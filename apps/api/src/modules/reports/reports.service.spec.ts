import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import type { ReportsRepository, OverviewRow } from './reports.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { ResourceAccessService } from '../../common/authz/resource-access.service.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make() {
  const rows: OverviewRow[] = [];
  const repo = {
    overviewForTeam: vi.fn().mockResolvedValue(rows),
    overviewForSelf: vi.fn().mockResolvedValue(rows),
  } as unknown as ReportsRepository;
  const access = {} as unknown as ResourceAccessService;
  return { svc: new ReportsService(repo, access), repo };
}

function makeReports() {
  const repo = {
    overviewForTeam: vi.fn().mockResolvedValue([]),
    overviewForSelf: vi.fn().mockResolvedValue([]),
    teamSummary: vi.fn().mockResolvedValue([]),
    projects: vi.fn().mockResolvedValue([]),
    trends: vi.fn().mockResolvedValue([]),
    streamEntries: vi.fn(),
  } as unknown as ReportsRepository;
  const access = {
    assertCanAccessUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResourceAccessService;
  return { svc: new ReportsService(repo, access), repo, access };
}

const range = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' };

describe('ReportsService.overview', () => {
  it('scopes a MANAGER to their own team', async () => {
    const { svc, repo } = make();
    await svc.overview({ date: '2026-07-12' }, manager);
    expect(repo.overviewForTeam).toHaveBeenCalledWith(
      't1',
      new Date('2026-07-12T00:00:00.000Z'),
      new Date('2026-07-13T00:00:00.000Z'),
    );
    expect(repo.overviewForSelf).not.toHaveBeenCalled();
  });

  it('scopes an ADMIN to their own team', async () => {
    const { svc, repo } = make();
    await svc.overview({ date: '2026-07-12' }, admin);
    expect(repo.overviewForTeam).toHaveBeenCalledWith('t1', expect.any(Date), expect.any(Date));
  });

  it('scopes an EMPLOYEE to themselves and never widens to the team', async () => {
    const { svc, repo } = make();
    await svc.overview({ date: '2026-07-12' }, employee);
    expect(repo.overviewForSelf).toHaveBeenCalledWith('u1', expect.any(Date), expect.any(Date));
    expect(repo.overviewForTeam).not.toHaveBeenCalled();
  });

  it('defaults the date to the current UTC day when absent', async () => {
    const { svc, repo } = make();
    const result = await svc.overview({}, manager);
    const today = new Date().toISOString().slice(0, 10);
    expect(result.date).toBe(today);
    expect(repo.overviewForTeam).toHaveBeenCalledWith(
      't1',
      new Date(`${today}T00:00:00.000Z`),
      new Date(new Date(`${today}T00:00:00.000Z`).getTime() + 86_400_000),
    );
  });
});

describe('ReportsService.teamSummary scope resolution', () => {
  it('MANAGER with no filter → own team', async () => {
    const { svc, repo } = makeReports();
    await svc.teamSummary({ ...range }, manager);
    expect(repo.teamSummary).toHaveBeenCalledWith(
      { kind: 'team', teamId: 't1' },
      new Date(range.from),
      new Date(range.to),
    );
  });

  it('ADMIN with no filter → all teams', async () => {
    const { svc, repo } = makeReports();
    await svc.teamSummary({ ...range }, admin);
    expect(repo.teamSummary).toHaveBeenCalledWith(
      { kind: 'all' },
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('ADMIN honors an explicit teamId filter', async () => {
    const { svc, repo } = makeReports();
    await svc.teamSummary({ ...range, teamId: 't2' }, admin);
    expect(repo.teamSummary).toHaveBeenCalledWith(
      { kind: 'team', teamId: 't2' },
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('MANAGER passing another team’s teamId → 403', async () => {
    const { svc, repo } = makeReports();
    await expect(svc.teamSummary({ ...range, teamId: 't2' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.teamSummary).not.toHaveBeenCalled();
  });

  it('userId filter delegates the ownership check to ResourceAccessService', async () => {
    const { svc, repo, access } = makeReports();
    await svc.teamSummary({ ...range, userId: 'uX' }, manager);
    expect(access.assertCanAccessUser).toHaveBeenCalledWith(manager, 'uX');
    expect(repo.teamSummary).toHaveBeenCalledWith(
      { kind: 'user', userId: 'uX' },
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('a userId the actor cannot access propagates the 403', async () => {
    const { svc, access } = makeReports();
    (access.assertCanAccessUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(svc.teamSummary({ ...range, userId: 'uX' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('projects() resolves scope the same way and returns a parsed ProjectSummary', async () => {
    const { svc, repo } = makeReports();
    const result = await svc.projects({ ...range }, manager);
    expect(repo.projects).toHaveBeenCalledWith(
      { kind: 'team', teamId: 't1' },
      expect.any(Date),
      expect.any(Date),
      undefined,
    );
    expect(result).toEqual({ from: range.from, to: range.to, rows: [] });
  });
});

describe('ReportsService.trends', () => {
  it('scopes a MANAGER with no params to their own team', async () => {
    const { svc, repo } = makeReports();
    await svc.trends(range, manager);
    expect(repo.trends).toHaveBeenCalledWith(
      { kind: 'team', teamId: 't1' },
      new Date(range.from),
      new Date(range.to),
    );
  });

  it('throws 403 when a MANAGER targets another team', async () => {
    const { svc } = makeReports();
    await expect(svc.trends({ ...range, teamId: 'other' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('gives an ADMIN the all-teams scope', async () => {
    const { svc, repo } = makeReports();
    await svc.trends(range, admin);
    expect(repo.trends).toHaveBeenCalledWith({ kind: 'all' }, expect.any(Date), expect.any(Date));
  });
});

async function drain(iterable: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of iterable) out += chunk;
  return out;
}

function streamOf(rows: import('./csv-writer.js').CsvEntryRow[]) {
  return (async function* () {
    for (const r of rows) yield await Promise.resolve(r);
  })();
}

describe('ReportsService.exportCsv', () => {
  const crossTeam = { ...range, teamId: 't2' };

  it('rejects a MANAGER reporting on another team BEFORE any row is produced', async () => {
    const { svc, repo } = makeReports();
    await expect(svc.exportCsv(crossTeam, manager)).rejects.toThrow(ForbiddenException);
    expect(repo.streamEntries).not.toHaveBeenCalled();
  });

  it('streams the header line then one formatted line per entry', async () => {
    const { svc, repo } = makeReports();
    (repo.streamEntries as ReturnType<typeof vi.fn>).mockReturnValue(
      streamOf([
        {
          entryId: 'e1',
          user: 'Ada',
          project: 'Acme',
          task: null,
          startTime: new Date('2026-07-02T09:00:00.000Z'),
          endTime: new Date('2026-07-02T10:00:00.000Z'),
          durationSeconds: 3600,
          source: 'MANUAL',
          note: null,
        },
      ]),
    );
    const csv = await drain(await svc.exportCsv({ ...range }, admin));
    expect(csv).toBe(
      'entryId,user,project,task,startTime,endTime,durationSeconds,source,note\r\n' +
        'e1,Ada,Acme,,2026-07-02T09:00:00.000Z,2026-07-02T10:00:00.000Z,3600,MANUAL,\r\n',
    );
    // ADMIN with no filter → kind:'all'
    expect(repo.streamEntries).toHaveBeenCalledWith(
      { kind: 'all' },
      new Date(range.from),
      new Date(range.to),
      undefined,
    );
  });
});

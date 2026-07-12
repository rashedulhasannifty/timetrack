import { describe, it, expect, vi } from 'vitest';
import { ReportsService } from './reports.service.js';
import type { ReportsRepository, OverviewRow } from './reports.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make() {
  const rows: OverviewRow[] = [];
  const repo = {
    overviewForTeam: vi.fn().mockResolvedValue(rows),
    overviewForSelf: vi.fn().mockResolvedValue(rows),
  } as unknown as ReportsRepository;
  return { svc: new ReportsService(repo), repo };
}

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

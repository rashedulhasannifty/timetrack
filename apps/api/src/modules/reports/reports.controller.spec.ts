import { describe, it, expect, vi } from 'vitest';
import { ReportsController } from './reports.controller.js';
import type { ReportsService } from './reports.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };

function make() {
  const service = {
    overview: vi.fn().mockResolvedValue({ date: '2026-07-14', rows: [] }),
    teamSummary: vi.fn().mockResolvedValue({}),
    exportCsv: vi.fn().mockResolvedValue('a,b\n1,2\n'),
    projects: vi.fn().mockResolvedValue({ from: 'x', to: 'y', rows: [] }),
  } as unknown as ReportsService;
  return { service, ctrl: new ReportsController(service) };
}

describe('ReportsController', () => {
  it('overview delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { date: '2026-07-14' };
    await ctrl.overview(query, user);
    expect(service.overview).toHaveBeenCalledWith(query, user);
  });

  it('teamSummary delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-01', to: '2026-07-14' };
    await ctrl.teamSummary(query, user);
    expect(service.teamSummary).toHaveBeenCalledWith(query, user);
  });

  it('exportCsv delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-01', to: '2026-07-14' };
    await ctrl.exportCsv(query, user);
    expect(service.exportCsv).toHaveBeenCalledWith(query, user);
  });

  it('projects delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' };
    await ctrl.projects(query, user);
    expect(service.projects).toHaveBeenCalledWith(query, user);
  });
});

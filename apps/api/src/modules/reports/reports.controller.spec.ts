import { describe, it, expect, vi } from 'vitest';
import { StreamableFile } from '@nestjs/common';
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

  it('exportCsv returns a text/csv StreamableFile draining the service iterable', async () => {
    const { ctrl, service } = make();
    // eslint-disable-next-line @typescript-eslint/require-await
    const iterable = (async function* () {
      yield 'entryId,user,project,task,startTime,endTime,durationSeconds,source,note\r\n';
      yield 'e1,Ada,,,2026-07-02T09:00:00.000Z,,3600,MANUAL,\r\n';
    })();
    (service.exportCsv as ReturnType<typeof vi.fn>).mockResolvedValue(iterable);

    const result = await ctrl.exportCsv(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' },
      user,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders().type).toBe('text/csv; charset=utf-8');
    expect(result.getHeaders().disposition).toContain('attachment; filename=');

    const chunks: Buffer[] = [];
    for await (const c of result.getStream()) chunks.push(Buffer.from(c as ArrayBufferLike));
    expect(Buffer.concat(chunks).toString('utf8')).toContain('e1,Ada,,,');
  });
});

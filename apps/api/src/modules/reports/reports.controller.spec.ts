import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import type { ReportsService } from './reports.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };

function make() {
  const service = {
    overview: vi.fn().mockResolvedValue({ date: '2026-07-14', rows: [] }),
    teamSummary: vi.fn().mockResolvedValue({}),
    exportCsv: vi.fn().mockResolvedValue('a,b\n1,2\n'),
    projects: vi.fn().mockResolvedValue({ from: 'x', to: 'y', rows: [] }),
    trends: vi.fn().mockResolvedValue({ from: 'x', to: 'y', days: [] }),
    teamActivity: vi.fn().mockResolvedValue({ from: 'x', to: 'y', rows: [] }),
    appUsage: vi.fn().mockResolvedValue({ from: 'x', to: 'y', rows: [] }),
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

  it('trends delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-14T00:00:00.000Z' };
    await ctrl.trends(query, user);
    expect(service.trends).toHaveBeenCalledWith(query, user);
  });

  it('teamActivity delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-14T00:00:00.000Z' };
    await ctrl.teamActivity(query, user);
    expect(service.teamActivity).toHaveBeenCalledWith(query, user);
  });

  it('appUsage delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-14T00:00:00.000Z', limit: 10 };
    await ctrl.appUsage(query, user);
    expect(service.appUsage).toHaveBeenCalledWith(query, user);
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

/**
 * Every other report route is MANAGER/ADMIN via the class-level @Roles; `overview` and
 * `app-usage` are the two deliberate exceptions. The RolesGuard produces the 403, so what this
 * pins is the metadata it reads (SetMetadata survives the decorator metadata vitest drops).
 */
describe('ReportsController authorization metadata', () => {
  const rolesFor = (handler: object): unknown => Reflect.getMetadata(ROLES, handler);

  it('keeps the controller MANAGER/ADMIN by default', () => {
    expect(Reflect.getMetadata(ROLES, ReportsController)).toEqual(['MANAGER', 'ADMIN']);
  });

  it('opens app-usage to EMPLOYEE so someone can see their own apps', () => {
    expect(rolesFor(ReportsController.prototype.appUsage)).toEqual([
      'EMPLOYEE',
      'MANAGER',
      'ADMIN',
    ]);
  });

  /**
   * my-totals is the Mac app's dropdown. Without this override the class-level MANAGER/ADMIN
   * applies and every employee gets a 403 reading their OWN totals — invisible in review,
   * because nothing on the route says it is restricted.
   */
  it('opens my-totals to EMPLOYEE so the Mac app can show a person their own time', () => {
    expect(rolesFor(ReportsController.prototype.myTotals)).toEqual([
      'EMPLOYEE',
      'MANAGER',
      'ADMIN',
    ]);
  });

  it('leaves the team-wide reports closed to EMPLOYEE', () => {
    // These read across people; only the self-scoped ones are widened.
    expect(rolesFor(ReportsController.prototype.teamSummary)).toBeUndefined();
    expect(rolesFor(ReportsController.prototype.trends)).toBeUndefined();
    expect(rolesFor(ReportsController.prototype.teamActivity)).toBeUndefined();
    expect(rolesFor(ReportsController.prototype.exportCsv)).toBeUndefined();
  });
});

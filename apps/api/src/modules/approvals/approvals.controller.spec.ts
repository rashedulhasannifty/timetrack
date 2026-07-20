import { describe, it, expect, vi } from 'vitest';
import { ApprovalsController } from './approvals.controller.js';
import type { ApprovalsService } from './approvals.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };

function make() {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue({ id: 'ts1', status: 'APPROVED' }),
  } as unknown as ApprovalsService;
  return { service, ctrl: new ApprovalsController(service) };
}

describe('ApprovalsController', () => {
  it('list delegates query + user', async () => {
    const { ctrl, service } = make();
    const query = { status: 'PENDING' as const };
    await ctrl.list(query, user);
    expect(service.list).toHaveBeenCalledWith(query, user);
  });
  it('decide delegates id + body + user', async () => {
    const { ctrl, service } = make();
    const body = { status: 'APPROVED' as const, note: 'ok' };
    await ctrl.decide('ts1', body, user);
    expect(service.decide).toHaveBeenCalledWith('ts1', body, user);
  });
});

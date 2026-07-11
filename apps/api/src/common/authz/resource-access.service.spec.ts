import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ResourceAccessService } from './resource-access.service.js';
import type { MembershipRepository } from './membership.repository.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make(isInTeam = false) {
  const membership = {
    isInTeam: vi.fn().mockResolvedValue(isInTeam),
  } as unknown as MembershipRepository;
  return { svc: new ResourceAccessService(membership), membership };
}

// The single resource-authorization rule, tested once. The 403 cases are the ones
// that matter (CLAUDE.md §4).
describe('ResourceAccessService.assertCanAccessUser', () => {
  it('lets a user access their own data', async () => {
    const { svc } = make();
    await expect(svc.assertCanAccessUser(employee, 'u1')).resolves.toBeUndefined();
  });

  it('forbids an employee accessing someone else', async () => {
    const { svc } = make();
    await expect(svc.assertCanAccessUser(employee, 'u2')).rejects.toThrow(ForbiddenException);
  });

  it('lets a manager access a member of their team', async () => {
    const { svc } = make(true);
    await expect(svc.assertCanAccessUser(manager, 'u1')).resolves.toBeUndefined();
  });

  it('forbids a manager accessing someone outside their team', async () => {
    const { svc, membership } = make(false);
    await expect(svc.assertCanAccessUser(manager, 'u9')).rejects.toThrow(ForbiddenException);
    expect(membership.isInTeam).toHaveBeenCalledWith('u9', 't1');
  });

  it('lets an admin access anyone', async () => {
    const { svc } = make();
    await expect(svc.assertCanAccessUser(admin, 'anyone')).resolves.toBeUndefined();
  });
});

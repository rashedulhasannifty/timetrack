import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ResourceGuard } from './resource.guard.js';
import type { ResourceAccessService } from '../authz/resource-access.service.js';
import type { ResourceScopeOptions } from '../decorators/resource-scope.decorator.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };

function ctx(req: Record<string, unknown>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function make(opts: ResourceScopeOptions | undefined, canAccess = true) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opts),
  } as unknown as Reflector;
  const assertCanAccessUser = vi.fn(
    canAccess ? () => Promise.resolve() : () => Promise.reject(new ForbiddenException()),
  );
  const access = { assertCanAccessUser } as unknown as ResourceAccessService;
  return { guard: new ResourceGuard(reflector, access), assertCanAccessUser };
}

describe('ResourceGuard', () => {
  it('allows a route with no @ResourceScope() decorator', async () => {
    const { guard, assertCanAccessUser } = make(undefined);
    await expect(guard.canActivate(ctx({ user }))).resolves.toBe(true);
    expect(assertCanAccessUser).not.toHaveBeenCalled();
  });

  it('allows when there is no session user to scope', async () => {
    const { guard, assertCanAccessUser } = make({ source: 'query', key: 'userId' });
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(assertCanAccessUser).not.toHaveBeenCalled();
  });

  it('scopes to the target user id read from the query', async () => {
    const { guard, assertCanAccessUser } = make({ source: 'query', key: 'userId' });
    await expect(guard.canActivate(ctx({ user, query: { userId: 'u2' } }))).resolves.toBe(true);
    expect(assertCanAccessUser).toHaveBeenCalledWith(user, 'u2');
  });

  it('scopes to the target user id read from the route param', async () => {
    const { guard, assertCanAccessUser } = make({ source: 'param', key: 'id' });
    await expect(guard.canActivate(ctx({ user, params: { id: 'u9' } }))).resolves.toBe(true);
    expect(assertCanAccessUser).toHaveBeenCalledWith(user, 'u9');
  });

  it('falls back to the caller id when the scoped id is absent (self)', async () => {
    const { guard, assertCanAccessUser } = make({ source: 'query', key: 'userId' });
    await expect(guard.canActivate(ctx({ user, query: {} }))).resolves.toBe(true);
    expect(assertCanAccessUser).toHaveBeenCalledWith(user, 'u1');
  });

  it('propagates the 403 when access is denied', async () => {
    const { guard } = make({ source: 'query', key: 'userId' }, false);
    await expect(guard.canActivate(ctx({ user, query: { userId: 'u2' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

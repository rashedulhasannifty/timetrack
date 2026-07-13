import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Role } from '@timetrack/contracts';
import { RolesGuard } from './roles.guard.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function ctx(user?: SessionUser) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function make(required: Role[] | undefined) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows a route with no @Roles() for any authenticated user', () => {
    expect(make(undefined).canActivate(ctx(employee))).toBe(true);
  });

  it('allows a route with an empty @Roles() list', () => {
    expect(make([]).canActivate(ctx(employee))).toBe(true);
  });

  it('allows a user whose role is in the required set', () => {
    expect(make(['ADMIN']).canActivate(ctx(admin))).toBe(true);
  });

  it('forbids a user whose role is not in the required set (403)', () => {
    expect(() => make(['ADMIN']).canActivate(ctx(employee))).toThrow(ForbiddenException);
  });

  it('forbids when there is no session user (403)', () => {
    expect(() => make(['ADMIN']).canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});

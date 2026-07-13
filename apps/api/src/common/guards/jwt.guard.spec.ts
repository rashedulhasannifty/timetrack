import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt.guard.js';

const SUB = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';

function ctx(headers: Record<string, string> = {}) {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function make(opts: { isPublic?: boolean; verify?: () => unknown } = {}) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opts.isPublic ?? false),
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: vi.fn(
      opts.verify ?? (() => Promise.resolve({ sub: SUB, role: 'EMPLOYEE', teamId: TEAM })),
    ),
  } as unknown as JwtService;
  return { guard: new JwtAuthGuard(jwt, reflector), jwt };
}

describe('JwtAuthGuard', () => {
  it('allows @Public routes without a token', async () => {
    const { guard } = make({ isPublic: true });
    const { context } = ctx();
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request with no Authorization header (401)', async () => {
    const { guard } = make();
    const { context } = ctx();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer Authorization header (401)', async () => {
    const { guard } = make();
    const { context } = ctx({ authorization: 'Basic abc' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifies a valid token and attaches the session identity', async () => {
    const { guard, jwt } = make();
    const { context, req } = ctx({ authorization: 'Bearer good.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('good.token');
    expect(req.user).toEqual({ id: SUB, role: 'EMPLOYEE', teamId: TEAM });
  });

  it('rejects a token whose claims fail the schema (401)', async () => {
    const { guard } = make({
      verify: () => Promise.resolve({ sub: 'not-a-uuid', role: 'EMPLOYEE', teamId: TEAM }),
    });
    const { context } = ctx({ authorization: 'Bearer bad.claims' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token that fails signature verification (401)', async () => {
    const { guard } = make({ verify: () => Promise.reject(new Error('bad signature')) });
    const { context } = ctx({ authorization: 'Bearer forged' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

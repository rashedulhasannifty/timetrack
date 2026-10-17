import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { TeamSettingsSchema } from '@timetrack/contracts';
import { MonitoringAckGuard } from './monitoring-ack.guard.js';
import type { CaptureContext, PolicyService } from '../../modules/policy/policy.service.js';
import type { RequiresMonitoringAckOptions } from '../decorators/requires-monitoring-ack.decorator.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const defaults = TeamSettingsSchema.parse({});

function ctx(req: Record<string, unknown>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function make(opts: RequiresMonitoringAckOptions | undefined, capture: CaptureContext | null) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(opts) } as unknown as Reflector;
  const captureContext = vi.fn().mockResolvedValue(capture);
  const policy = { captureContext } as unknown as PolicyService;
  return { guard: new MonitoringAckGuard(reflector, policy), captureContext };
}

describe('MonitoringAckGuard', () => {
  it('ignores a route without @RequiresMonitoringAck() — no lookup at all', async () => {
    const { guard, captureContext } = make(undefined, null);
    await expect(guard.canActivate(ctx({ user }))).resolves.toBe(true);
    expect(captureContext).not.toHaveBeenCalled();
  });

  it('403s an unacknowledged user, with a problem+json body naming the reason', async () => {
    const { guard, captureContext } = make({}, { acknowledged: false, settings: defaults });
    const err = await guard.canActivate(ctx({ user })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      status: 403,
      title: 'Monitoring policy not acknowledged',
    });
    expect(captureContext).toHaveBeenCalledWith('u1');
  });

  it('403s a user that no longer exists (fails closed)', async () => {
    const { guard } = make({}, null);
    await expect(guard.canActivate(ctx({ user }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s when there is no session user (fails closed)', async () => {
    const { guard, captureContext } = make({}, { acknowledged: true, settings: defaults });
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(ForbiddenException);
    expect(captureContext).not.toHaveBeenCalled();
  });

  it('allows an acknowledged user and leaves the team settings on the request', async () => {
    const { guard } = make({}, { acknowledged: true, settings: defaults });
    const req: Record<string, unknown> = { user };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.captureSettings).toBe(defaults);
  });

  it('403s an acknowledged user when the required team setting is off', async () => {
    const settings = { ...defaults, screenshotsEnabled: false };
    const { guard } = make({ setting: 'screenshotsEnabled' }, { acknowledged: true, settings });
    const err = await guard.canActivate(ctx({ user })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      status: 403,
      title: 'Capture disabled by team policy',
    });
  });

  it('allows when the required team setting is on', async () => {
    const { guard } = make(
      { setting: 'screenshotsEnabled' },
      { acknowledged: true, settings: defaults },
    );
    await expect(guard.canActivate(ctx({ user }))).resolves.toBe(true);
  });
});

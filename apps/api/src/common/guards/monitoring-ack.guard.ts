import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRES_MONITORING_ACK,
  type CaptureRequest,
  type RequiresMonitoringAckOptions,
} from '../decorators/requires-monitoring-ack.decorator.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';
import { PolicyService } from '../../modules/policy/policy.service.js';

/**
 * CLAUDE.md §1 / PRD §4.1 — the server-side monitoring gate. Runs after JwtAuthGuard and the
 * authorization guards. A route that declares `@RequiresMonitoringAck()` is refused with 403
 * problem+json unless the caller has acknowledged the monitoring policy and, when the route
 * names one, the required team setting is on. Routes without the decorator are unaffected.
 *
 * One indexed lookup by primary key per gated request (the same query `GET /policy/effective`
 * makes). On success the resolved team settings are left on the request for `@CaptureSettings()`,
 * so the handler needs no second query.
 *
 * Explicit @Inject: vitest's esbuild transform emits no constructor metadata.
 */
@Injectable()
export class MonitoringAckGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RequiresMonitoringAckOptions | undefined>(
      REQUIRES_MONITORING_ACK,
      [context.getHandler(), context.getClass()],
    );
    if (!opts) return true;

    const req = context.switchToHttp().getRequest<CaptureRequest & { user?: SessionUser }>();
    // Fail closed: a capture route with no session user is refused, never waved through.
    const capture = req.user ? await this.policy.captureContext(req.user.id) : null;
    if (!capture?.acknowledged) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/monitoring-not-acknowledged',
        title: 'Monitoring policy not acknowledged',
        status: 403,
        detail: 'Capture data is not accepted until the monitoring policy is acknowledged.',
      });
    }
    if (opts.setting && !capture.settings[opts.setting]) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/capture-disabled',
        title: 'Capture disabled by team policy',
        status: 403,
        detail: `This capture is switched off for your team (${opts.setting}).`,
      });
    }

    req.captureSettings = capture.settings;
    return true;
  }
}

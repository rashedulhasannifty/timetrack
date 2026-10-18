import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { TeamSettings } from '@timetrack/contracts';

/** The boolean team settings — the only ones a capture route can require to be switched on. */
export type CaptureToggle = {
  [K in keyof TeamSettings]: TeamSettings[K] extends boolean ? K : never;
}[keyof TeamSettings];

export interface RequiresMonitoringAckOptions {
  /** A team setting that must also be ON, e.g. `screenshotsEnabled` for the screenshot upload. */
  setting?: CaptureToggle;
}

/**
 * CLAUDE.md §1 / PRD §4.1 — declares a route as a monitoring-capture INGEST. The global
 * `MonitoringAckGuard` then refuses it (403 problem+json) unless the caller has acknowledged the
 * monitoring policy (`users.monitoringAckAt` non-null), and — when `setting` is given — unless
 * that team setting is on. It runs as a guard, so before the handler touches the body: a refused
 * screenshot is never streamed to storage.
 *
 * This is the server-side twin of each client's `Policy/AckGate`: ONE declarative gate, not a
 * scattered runtime `if`. There is no admin override. Time entries are deliberately NOT gated —
 * manual time tracking is permitted before acknowledgement.
 *
 *   @Post()
 *   @RequiresMonitoringAck({ setting: 'screenshotsEnabled' })
 *   upload(...) { ... }
 */
export const REQUIRES_MONITORING_ACK = 'requiresMonitoringAck';
export const RequiresMonitoringAck = (options: RequiresMonitoringAckOptions = {}) =>
  SetMetadata(REQUIRES_MONITORING_ACK, options);

/** Where the guard leaves the team settings it already loaded, so a handler needs no 2nd query. */
export interface CaptureRequest {
  captureSettings?: TeamSettings;
}

/**
 * The caller's resolved team settings, as loaded by `MonitoringAckGuard`. Only meaningful on a
 * route that carries `@RequiresMonitoringAck()` — the guard guarantees it is set there.
 */
export const CaptureSettings = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TeamSettings => {
    const settings = ctx.switchToHttp().getRequest<CaptureRequest>().captureSettings;
    if (!settings) {
      // A programming error (decorator used without the guard's metadata), never a client one.
      throw new Error('@CaptureSettings() used on a route without @RequiresMonitoringAck()');
    }
    return settings;
  },
);

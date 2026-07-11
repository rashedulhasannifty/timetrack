import { Injectable, NotFoundException } from '@nestjs/common';
import { EffectivePolicySchema, TeamSettingsSchema, type EffectivePolicy } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { PolicyRepository } from './policy.repository.js';

/**
 * PRD §4.1 — the monitoring policy is enforced SERVER-SIDE here. `ackRequired` is true
 * whenever the user has not acknowledged (monitoring_ack_at is null); the macOS client's
 * AckGate refuses to capture while it is true. There is no admin override.
 */
const POLICY_VERSION = 'v1';
const POLICY_TEXT =
  'This device records work activity: time entries, active application, activity ' +
  'levels, and periodic screenshots, per your team policy. You can view everything ' +
  'recorded about you. Monitoring does not run until you acknowledge this notice.';

@Injectable()
export class PolicyService {
  constructor(private readonly repo: PolicyRepository) {}

  async effective(user: SessionUser): Promise<EffectivePolicy> {
    const row = await this.repo.getUserPolicy(user.id);
    if (!row) throw new NotFoundException({ title: 'User not found', status: 404 });
    return EffectivePolicySchema.parse({
      ackRequired: row.monitoringAckAt === null,
      policyVersion: POLICY_VERSION,
      policyText: POLICY_TEXT,
      // TODO(scaffold): move POLICY_VERSION/TEXT to a versioned policy record so a new
      //                 policy revision re-triggers ackRequired for everyone.
      settings: TeamSettingsSchema.parse(row.team.settings ?? {}),
    });
  }
}

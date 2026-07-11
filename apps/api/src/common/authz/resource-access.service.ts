import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SessionUser } from '../decorators/current-user.decorator.js';
import { MembershipRepository } from './membership.repository.js';

/**
 * CLAUDE.md §4 — authorization is checked against the RESOURCE, not just the role.
 * This is the ONE place the "can this actor touch this user's data" rule lives:
 *
 *   ADMIN  → any user
 *   self   → own data
 *   MANAGER→ only members of their own team
 *   else   → 403
 *
 * The `ResourceGuard` applies it declaratively via `@ResourceScope`; services with
 * non-standard resolution call it directly. Either way the rule is defined once and
 * tested once (resource-access.service.spec).
 */
@Injectable()
export class ResourceAccessService {
  constructor(private readonly membership: MembershipRepository) {}

  async assertCanAccessUser(actor: SessionUser, targetUserId: string): Promise<void> {
    if (actor.role === 'ADMIN' || actor.id === targetUserId) return;
    if (actor.role === 'MANAGER' && (await this.membership.isInTeam(targetUserId, actor.teamId))) {
      return;
    }
    throw new ForbiddenException({
      type: 'https://timetrack.internal/errors/forbidden',
      title: 'Not permitted to access this user',
      status: 403,
    });
  }
}

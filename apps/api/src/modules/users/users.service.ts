import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import type {
  AckMonitoring,
  InviteResult,
  InviteUser,
  UpdateUser,
  User,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { InvitesService } from '../invites/invites.service.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly invites: InvitesService,
  ) {}

  /** Managers and admins list their own team; the controller gates the role. */
  list(user: SessionUser): Promise<User[]> {
    return this.repo.listByTeam(user.teamId);
  }

  /**
   * Deactivate (revokes sessions) or reactivate a user. ADMIN-gated in the controller;
   * here we enforce same team only and no self-deactivation. The last-active-admin guard
   * is authoritative in `repo.setActive` (a locked re-check inside its transaction) — we
   * just translate its LAST_ADMIN sentinel to a 409 here.
   */
  async setActive(id: string, dto: UpdateUser, actor: SessionUser): Promise<User> {
    const target = await this.repo.findForAdmin(id);
    if (!target) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'User not found',
        status: 404,
      });
    }
    if (target.teamId !== actor.teamId) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Cannot manage a user in another team',
        status: 403,
      });
    }
    if (dto.deactivated && id === actor.id) {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'You cannot deactivate your own account',
        status: 409,
      });
    }
    const result = await this.repo.setActive(id, dto.deactivated, actor.id);
    if (result.status === 'LAST_ADMIN') {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'Cannot deactivate the last active admin',
        status: 409,
      });
    }
    return result.user;
  }

  async invite(dto: InviteUser, actor: SessionUser): Promise<InviteResult> {
    const { invite, token } = await this.invites.create(dto, actor);
    const result: InviteResult = {
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        teamId: invite.teamId,
        expiresAt: invite.expiresAt.toISOString(),
      },
    };
    // Dev-only fallback so the flow is testable before SMTP exists. Strictly development.
    if (loadEnv().NODE_ENV === 'development') result.devToken = token;
    return result;
  }

  /**
   * PRD §4.1 — a user may only acknowledge the policy for THEMSELVES. There is no
   * admin override; an admin cannot ack on someone's behalf.
   */
  async ackMonitoring(userId: string, dto: AckMonitoring, actor: SessionUser): Promise<User> {
    if (userId !== actor.id) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Monitoring can only be acknowledged for yourself',
        status: 403,
      });
    }
    return this.repo.ackMonitoring(userId, dto.policyVersion, actor.id);
  }
}

import { ForbiddenException, Injectable, NotImplementedException } from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import type { AckMonitoring, InviteResult, InviteUser, User } from '@timetrack/contracts';
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
  ackMonitoring(userId: string, _dto: AckMonitoring, actor: SessionUser): Promise<User> {
    if (userId !== actor.id) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Monitoring can only be acknowledged for yourself',
        status: 403,
      });
    }
    // TODO(scaffold): repo.ackMonitoring(userId, dto.policyVersion).
    throw new NotImplementedException('users.ackMonitoring not yet implemented');
  }
}

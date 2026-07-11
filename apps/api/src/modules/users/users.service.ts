import { ForbiddenException, Injectable, NotImplementedException } from '@nestjs/common';
import type { AckMonitoring, InviteUser, User } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  /** Managers and admins list their own team; the controller gates the role. */
  list(user: SessionUser): Promise<User[]> {
    return this.repo.listByTeam(user.teamId);
  }

  invite(_dto: InviteUser, _actor: SessionUser): Promise<User> {
    // TODO(scaffold): admin-only create + invite email. Enforce teamId ownership.
    throw new NotImplementedException('users.invite not yet implemented');
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

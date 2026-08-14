import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import type {
  AckMonitoring,
  InviteResult,
  InviteUser,
  Role,
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

  /**
   * A MANAGER lists their own team. An ADMIN lists the whole deployment: they assign people to
   * managers by moving them between teams, which is impossible from a roster that only ever
   * shows the admin's own team. The controller gates the role; this decides the scope.
   */
  list(user: SessionUser): Promise<User[]> {
    return user.role === 'ADMIN' ? this.repo.listAll() : this.repo.listByTeam(user.teamId);
  }

  /** Self-read: any authenticated user fetches their own record. */
  async me(user: SessionUser): Promise<User> {
    const found = await this.repo.findUser(user.id);
    if (!found) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'User not found',
        status: 404,
      });
    }
    return found;
  }

  /**
   * ADMIN-gated user mutation: change role, team and/or active state.
   *
   * Scope is org-wide. This deliberately replaced a same-team check: teams are the unit of
   * management (a MANAGER manages their own team), so assigning an employee to a manager means
   * moving them between teams — and a team-scoped admin could neither see the destination's
   * people nor pull anyone into their own team. A second team would have had no admin able to
   * manage it at all. MANAGER scope is untouched and remains strictly own-team.
   *
   * The last-active-admin guard is authoritative inside each repo transaction (a locked
   * re-check) — we translate its LAST_ADMIN sentinel to a 409. Fields are applied role → team →
   * active; the final User is returned.
   */
  async update(id: string, dto: UpdateUser, actor: SessionUser): Promise<User> {
    const target = await this.repo.findForAdmin(id);
    if (!target) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'User not found',
        status: 404,
      });
    }

    let user: User | undefined;
    if (dto.role !== undefined) {
      user = await this.applyRole(id, dto.role, target.role, actor);
    }
    if (dto.teamId !== undefined) {
      user = await this.applyTeam(id, dto.teamId, target.teamId, actor);
    }
    if (dto.deactivated !== undefined) {
      user = await this.applyActive(id, dto.deactivated, actor);
    }
    // UpdateUserSchema's refine guarantees at least one field was present.
    return user as User;
  }

  /**
   * Move a user to another team — i.e. hand them to a different manager. The destination is
   * checked to exist first: the FK would reject a bad id anyway, but as a raw Prisma error
   * rather than the 422 an admin who mistyped an id deserves.
   */
  private async applyTeam(
    id: string,
    teamId: string,
    currentTeamId: string,
    actor: SessionUser,
  ): Promise<User> {
    // No-op: already on that team. Return the record unchanged, with no spurious audit row.
    if (teamId === currentTeamId) {
      const current = await this.repo.findUser(id);
      return current as User; // existence already established by findForAdmin
    }
    if (!(await this.repo.teamExists(teamId))) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Team not found',
        status: 422,
      });
    }
    return this.repo.setTeam(id, teamId, actor.id);
  }

  private async applyRole(
    id: string,
    role: Role,
    currentRole: Role,
    actor: SessionUser,
  ): Promise<User> {
    // No-op: role unchanged. Return the current record without a spurious audit row.
    if (role === currentRole) {
      const current = await this.repo.findUser(id);
      return current as User; // existence already established by findForAdmin
    }
    // No self-demotion: an admin cannot drop their own ADMIN role (self-lockout). Mirrors the
    // no-self-deactivation rule, so it is a 409 like that guard.
    if (id === actor.id && currentRole === 'ADMIN' && role !== 'ADMIN') {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'You cannot change your own role',
        status: 409,
      });
    }
    const result = await this.repo.setRole(id, role, actor.id);
    if (result.status === 'LAST_ADMIN') {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'Cannot demote the last active admin',
        status: 409,
      });
    }
    return result.user;
  }

  private async applyActive(id: string, deactivated: boolean, actor: SessionUser): Promise<User> {
    if (deactivated && id === actor.id) {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'You cannot deactivate your own account',
        status: 409,
      });
    }
    const result = await this.repo.setActive(id, deactivated, actor.id);
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

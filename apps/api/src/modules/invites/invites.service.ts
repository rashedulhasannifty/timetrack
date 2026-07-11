import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { InviteUser, Role } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { QueueService, QUEUES } from '../../infra/queue/queue.module.js';
import { InvitesRepository, type AcceptedInvite } from './invites.repository.js';

const INVITE_TTL_HOURS = 72;

export interface CreatedInvite {
  invite: { id: string; email: string; role: Role; teamId: string; expiresAt: Date };
  token: string;
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly repo: InvitesRepository,
    private readonly queue: QueueService,
  ) {}

  async create(dto: InviteUser, actor: SessionUser): Promise<CreatedInvite> {
    // Defence beyond the controller's @Roles('ADMIN'): an admin may only invite into
    // their own team (resource authorization, not just role).
    if (actor.role !== 'ADMIN' || actor.teamId !== dto.teamId) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Cannot invite a user into another team',
        status: 403,
      });
    }
    if (await this.repo.emailExistsAsUser(dto.email)) {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/email-in-use',
        title: 'A user with this email already exists',
        status: 409,
      });
    }
    if (await this.repo.hasActivePendingInvite(dto.email)) {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/invite-pending',
        title: 'An invitation for this email is already pending',
        status: 409,
      });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    const created = await this.repo.createInvite({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      teamId: dto.teamId,
      tokenHash: this.hashToken(token),
      expiresAt,
    });

    // Commit-then-enqueue: PG and Redis can't share a transaction. A failed enqueue fails
    // the request (design decision) rather than silently dropping the invite email.
    await this.queue.enqueue(QUEUES.email, 'invite', {
      email: dto.email,
      name: dto.name,
      inviteToken: token,
      expiresAt: created.expiresAt.toISOString(),
    });

    return {
      invite: {
        id: created.id,
        email: dto.email,
        role: dto.role,
        teamId: dto.teamId,
        expiresAt: created.expiresAt,
      },
      token,
    };
  }

  async accept(token: string, password: string): Promise<AcceptedInvite> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const accepted = await this.repo.acceptInTransaction(
      this.hashToken(token),
      passwordHash,
      new Date(),
    );
    if (!accepted) {
      throw new UnauthorizedException({
        type: 'https://timetrack.internal/errors/invalid-invite',
        title: 'Invalid or expired invite',
        status: 401,
      });
    }
    return accepted;
  }

  /** SHA-256 of a 256-bit random token — see design: the token's entropy is the security. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

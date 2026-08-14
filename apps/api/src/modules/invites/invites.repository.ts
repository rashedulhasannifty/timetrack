import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { Role } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface CreateInviteInput {
  email: string;
  name: string;
  role: Role;
  teamId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AcceptedInvite {
  userId: string;
  role: Role;
  teamId: string;
}

/** CLAUDE.md §3 — Prisma lives HERE. Nothing here logs a token or hash. */
@Injectable()
export class InvitesRepository {
  constructor(private readonly prisma: PrismaService) {}

  createInvite(input: CreateInviteInput): Promise<{ id: string; expiresAt: Date }> {
    return this.prisma.invite.create({ data: input, select: { id: true, expiresAt: true } });
  }

  /** Destination check for an invite, so a mistyped team id is a 422 and not an FK error. */
  async teamExists(teamId: string): Promise<boolean> {
    const count = await this.prisma.team.count({ where: { id: teamId } });
    return count > 0;
  }

  async emailExistsAsUser(email: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return user !== null;
  }

  /**
   * True when the email already has a still-valid (unaccepted, unexpired) invite. Blocks a
   * second pending invite for the same email; an EXPIRED unaccepted invite does not block a
   * re-invite. (Prisma cannot express a partial unique index without a preview feature, so
   * this guard lives here; acceptInTransaction's P2002 catch is the concurrency backstop.)
   */
  async hasActivePendingInvite(email: string): Promise<boolean> {
    const invite = await this.prisma.invite.findFirst({
      where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return invite !== null;
  }

  /**
   * Single-use accept: consume the invite and create the user in ONE transaction. The
   * conditional update (updateMany WHERE acceptedAt IS NULL, count === 1) makes a replayed
   * token a no-op even under concurrency; the User.email unique index is the final backstop.
   * Returns null when the token is unknown, expired, or already consumed.
   */
  async acceptInTransaction(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<AcceptedInvite | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invite = await tx.invite.findUnique({
          where: { tokenHash },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            teamId: true,
            expiresAt: true,
            acceptedAt: true,
          },
        });
        if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= now.getTime()) {
          return null;
        }
        const consumed = await tx.invite.updateMany({
          where: { id: invite.id, acceptedAt: null },
          data: { acceptedAt: now },
        });
        if (consumed.count !== 1) return null; // lost a concurrent race
        const user = await tx.user.create({
          data: {
            email: invite.email,
            name: invite.name,
            role: invite.role,
            teamId: invite.teamId,
            passwordHash,
          },
          select: { id: true, role: true, teamId: true },
        });
        return { userId: user.id, role: user.role, teamId: user.teamId };
      });
    } catch (e) {
      // A duplicate pending invite whose email was registered first hits the User.email
      // unique index (P2002). The transaction rolls back; surface it as an invalid invite
      // (→ 401) instead of a 500. Any other error is a real fault — rethrow it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }
}

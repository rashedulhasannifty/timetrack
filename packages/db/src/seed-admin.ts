import argon2 from 'argon2';
import type { PrismaClient } from '../generated/client/client.js';

export interface SeedAdminInput {
  email: string;
  password: string;
  name?: string;
  teamId: string;
}

/**
 * Idempotently create a bootstrap ADMIN. The password is Argon2id-hashed to match
 * AuthService (PRD §6.8) so the seeded admin logs in through the normal path.
 * Re-running is a no-op on an existing email — the hash is never rotated here.
 */
export async function seedAdmin(
  prisma: PrismaClient,
  input: SeedAdminInput,
): Promise<{ id: string; email: string }> {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      name: input.name ?? 'Admin',
      role: 'ADMIN',
      passwordHash,
      teamId: input.teamId,
    },
    select: { id: true, email: true },
  });
}

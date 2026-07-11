import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock factory can safely reference this shared, mutable holder
// (a plain top-level const would be in the TDZ when the hoisted factory runs).
const { nodeEnv } = vi.hoisted(() => ({ nodeEnv: { value: 'development' } }));
vi.mock('@timetrack/config', () => ({ loadEnv: () => ({ NODE_ENV: nodeEnv.value }) }));

import { UsersService } from './users.service.js';
import type { UsersRepository } from './users.repository.js';
import type { InvitesService } from '../invites/invites.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const dto = { email: 'new@ex.co', name: 'New', role: 'EMPLOYEE' as const, teamId: 't1' };
const created = {
  invite: {
    id: 'inv1',
    email: 'new@ex.co',
    role: 'EMPLOYEE' as const,
    teamId: 't1',
    expiresAt: new Date('2026-07-15T00:00:00Z'),
  },
  token: 'secret-token',
};

function makeService() {
  const repo = {} as unknown as UsersRepository;
  const invites = { create: vi.fn().mockResolvedValue(created) } as unknown as InvitesService;
  return { svc: new UsersService(repo, invites) };
}

beforeEach(() => vi.clearAllMocks());

describe('UsersService.invite devToken gating', () => {
  it('includes devToken in development', async () => {
    nodeEnv.value = 'development';
    const { svc } = makeService();
    const result = await svc.invite(dto, admin);
    expect(result.devToken).toBe('secret-token');
    expect(result.invite.expiresAt).toBe('2026-07-15T00:00:00.000Z');
  });

  it('omits devToken outside development', async () => {
    nodeEnv.value = 'production';
    const { svc } = makeService();
    const result = await svc.invite(dto, admin);
    expect(result.devToken).toBeUndefined();
  });
});

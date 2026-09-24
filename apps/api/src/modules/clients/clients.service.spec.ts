import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { ClientsService, clientFromHeaders } from './clients.service.js';
import type { ClientsRepository } from './clients.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make(repo: Partial<ClientsRepository> = {}) {
  const fullRepo = {
    upsert: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    ...repo,
  } as unknown as ClientsRepository;
  const logger = { warn: vi.fn() } as unknown as Logger;
  return { svc: new ClientsService(fullRepo, logger), repo: fullRepo, logger };
}

describe('clientFromHeaders', () => {
  it('reads the X-Client headers', () => {
    expect(
      clientFromHeaders({ 'x-client-platform': 'WINDOWS', 'x-client-version': '0.3.0' }),
    ).toEqual({ platform: 'WINDOWS', version: '0.3.0' });
  });

  it('prefers the headers over a legacy User-Agent', () => {
    expect(
      clientFromHeaders({
        'x-client-platform': 'MACOS',
        'x-client-version': '0.7.0',
        'user-agent': 'Nifty%20Timer/9 CFNetwork/3826.500.131 Darwin/25.3.0',
      }),
    ).toEqual({ platform: 'MACOS', version: '0.7.0' });
  });

  it('maps a pre-header Mac build number to its release', () => {
    expect(
      clientFromHeaders({ 'user-agent': 'Nifty%20Timer/9 CFNetwork/3826.500.131 Darwin/25.3.0' }),
    ).toEqual({ platform: 'MACOS', version: '0.6.1' });
    expect(clientFromHeaders({ 'user-agent': 'TimeTrack/2 CFNetwork/1568 Darwin/24.0.0' })).toEqual(
      {
        platform: 'MACOS',
        version: '0.2.0',
      },
    );
  });

  it('records nothing it cannot identify', () => {
    expect(clientFromHeaders({})).toBeNull();
    expect(clientFromHeaders({ 'user-agent': 'node' })).toBeNull();
    // A build number outside the frozen table is not guessed at.
    expect(
      clientFromHeaders({ 'user-agent': 'Nifty%20Timer/42 CFNetwork/1 Darwin/25' }),
    ).toBeNull();
    // A malformed header does not fall through to a wrong answer or an error.
    expect(
      clientFromHeaders({ 'x-client-platform': 'LINUX', 'x-client-version': '1.0.0' }),
    ).toBeNull();
    expect(
      clientFromHeaders({ 'x-client-platform': 'MACOS', 'x-client-version': '0.7.0-pilot' }),
    ).toBeNull();
  });
});

describe('ClientsService.record', () => {
  it('upserts the report with a timestamp', async () => {
    const { svc, repo } = make();
    await svc.record('u1', { platform: 'MACOS', version: '0.7.0' });
    const row = vi.mocked(repo.upsert).mock.calls[0]![0];
    expect(row).toMatchObject({ userId: 'u1', platform: 'MACOS', version: '0.7.0' });
    expect(row.lastSeenAt).toBeInstanceOf(Date);
  });

  it('does nothing without a report', async () => {
    const { svc, repo } = make();
    await svc.record('u1', null);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('swallows and logs a failed write, so sign-in never fails over it', async () => {
    const { svc, logger } = make({ upsert: vi.fn().mockRejectedValue(new Error('db down')) });
    await expect(
      svc.record('u1', { platform: 'MACOS', version: '0.7.0' }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', reason: 'db down' }),
      'client version not recorded',
    );
  });
});

describe('ClientsService.list', () => {
  it('rejects a non-admin with 403', async () => {
    const { svc, repo } = make();
    await expect(svc.list({ ...admin, role: 'MANAGER' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('returns ISO timestamps', async () => {
    const lastSeenAt = new Date('2026-09-24T10:00:00Z');
    const { svc } = make({
      list: vi
        .fn()
        .mockResolvedValue([{ userId: 'u1', platform: 'MACOS', version: '0.7.0', lastSeenAt }]),
    });
    expect(await svc.list(admin)).toEqual([
      { userId: 'u1', platform: 'MACOS', version: '0.7.0', lastSeenAt: '2026-09-24T10:00:00.000Z' },
    ]);
  });
});

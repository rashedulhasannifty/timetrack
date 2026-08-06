import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import type { AdminRepository } from './admin.repository.js';
import type { MinioService } from '../../infra/storage/minio.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function makeService(overrides: Partial<AdminRepository> = {}) {
  const repo = {
    getSettings: vi.fn().mockResolvedValue({}),
    writeSettings: vi.fn().mockResolvedValue(undefined),
    listAudit: vi.fn(),
    ...overrides,
  } as unknown as AdminRepository;
  const storage = { deleteByPrefix: vi.fn() } as unknown as MinioService;
  return { svc: new AdminService(repo, storage), repo };
}

describe('AdminService.updateSettings', () => {
  it('merges the patch over defaults and returns a complete, valid TeamSettings', async () => {
    const { svc, repo } = makeService();
    const result = await svc.updateSettings({ screenshotIntervalMinutes: 20 }, actor);
    expect(result.screenshotIntervalMinutes).toBe(20);
    // unspecified fields keep their schema defaults
    expect(result.screenshotRetentionDays).toBe(30);
    expect(repo.writeSettings).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ screenshotIntervalMinutes: 20 }),
      expect.objectContaining({
        before: expect.any(Object) as object,
        after: expect.any(Object) as object,
      }),
      'a1',
    );
  });

  it('rejects an out-of-range value via merged-object validation (never writes)', async () => {
    const { svc, repo } = makeService();
    await expect(
      svc.updateSettings({ screenshotRetentionDays: 999 }, actor),
    ).rejects.toBeInstanceOf(ZodError);
    expect(repo.writeSettings).not.toHaveBeenCalled();
  });

  it('normalizes a legacy/partial stored settings row before merging', async () => {
    const { svc } = makeService({
      getSettings: vi.fn().mockResolvedValue({ screenshotIntervalMinutes: 45 }),
    });
    const result = await svc.updateSettings({ screenshotBlur: 'BLUR' }, actor);
    expect(result.screenshotIntervalMinutes).toBe(45); // preserved from stored
    expect(result.screenshotBlur).toBe('BLUR'); // from patch
    expect(result.idleThresholdMinutes).toBe(5); // default filled
  });
});

describe('AdminService.listObservedApps', () => {
  it('delegates to the repo with the actor team and wraps the apps', async () => {
    const apps = [
      { name: 'Code', bundleId: 'com.microsoft.VSCode' },
      { name: 'Slack', bundleId: null },
    ];
    const { svc, repo } = makeService({
      listObservedApps: vi.fn().mockResolvedValue(apps),
    });
    await expect(svc.listObservedApps(actor)).resolves.toEqual({ apps });
    expect(repo.listObservedApps).toHaveBeenCalledWith('t1');
  });
});

describe('AdminService.listAudit', () => {
  it('passes the query straight to the repository and returns its page', async () => {
    const page = { items: [], nextCursor: null };
    const { svc, repo } = makeService({ listAudit: vi.fn().mockResolvedValue(page) });
    const query = { targetType: 'user', limit: 50 } as never;
    await expect(svc.listAudit(query)).resolves.toBe(page);
    expect(repo.listAudit).toHaveBeenCalledWith(query);
  });
});

describe('AdminService.eraseUser guards', () => {
  const actor: SessionUser = { id: 'admin-1', role: 'ADMIN', teamId: 't1' };
  const target = {
    id: 'u2',
    email: 'u2@x.com',
    teamId: 't1',
    role: 'EMPLOYEE' as const,
    deactivatedAt: null,
  };
  function make(overrides: Record<string, unknown> = {}, targetRow: unknown = target) {
    const repo = {
      findForErase: vi.fn().mockResolvedValue(targetRow),
      countActiveAdmins: vi.fn().mockResolvedValue(2),
      eraseUser: vi.fn().mockResolvedValue({ status: 'OK', counts: {} }),
      ...overrides,
    } as unknown as AdminRepository;
    const storage = { deleteByPrefix: vi.fn().mockResolvedValue(3) } as unknown as MinioService;
    return { svc: new AdminService(repo, storage), repo, storage };
  }

  it('404s an unknown user without sweeping or erasing', async () => {
    const { svc, repo, storage } = make({}, null);
    await expect(svc.eraseUser('nope', { reason: 'r' }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.deleteByPrefix).not.toHaveBeenCalled();
    expect(repo.eraseUser).not.toHaveBeenCalled();
  });

  it('403s a user in another team without sweeping or erasing', async () => {
    const { svc, repo, storage } = make({}, { ...target, teamId: 'other-team' });
    await expect(svc.eraseUser('u2', { reason: 'r' }, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(storage.deleteByPrefix).not.toHaveBeenCalled();
    expect(repo.eraseUser).not.toHaveBeenCalled();
  });

  it('409s self-erase without sweeping or erasing', async () => {
    const { svc, repo, storage } = make({}, { ...target, id: 'admin-1' });
    await expect(svc.eraseUser('admin-1', { reason: 'r' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.deleteByPrefix).not.toHaveBeenCalled();
    expect(repo.eraseUser).not.toHaveBeenCalled();
  });

  it('409s when the repository reports LAST_ADMIN', async () => {
    const { svc } = make({ eraseUser: vi.fn().mockResolvedValue({ status: 'LAST_ADMIN' }) });
    await expect(svc.eraseUser('u2', { reason: 'r' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409s the last-admin PRE-CHECK for a solo active admin, without sweeping or calling repo.eraseUser', async () => {
    const { svc, repo, storage } = make(
      { countActiveAdmins: vi.fn().mockResolvedValue(1) },
      { ...target, role: 'ADMIN' as const, deactivatedAt: null },
    );
    await expect(svc.eraseUser('u2', { reason: 'r' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.deleteByPrefix).not.toHaveBeenCalled();
    expect(repo.eraseUser).not.toHaveBeenCalled();
  });

  it('sweeps BOTH object prefixes before delegating, and passes the real email + count', async () => {
    const { svc, repo, storage } = make();
    await svc.eraseUser('u2', { reason: 'GDPR' }, actor);
    expect(storage.deleteByPrefix).toHaveBeenCalledWith('raw/u2/');
    expect(storage.deleteByPrefix).toHaveBeenCalledWith('thumb/u2/');
    expect(repo.eraseUser).toHaveBeenCalledWith('u2', 'u2@x.com', 'admin-1', 'GDPR', 6);
  });

  it('aborts without erasing when the object sweep fails', async () => {
    const { repo } = make();
    const storage = {
      deleteByPrefix: vi.fn().mockRejectedValue(new Error('minio down')),
    } as unknown as MinioService;
    const s = new AdminService(repo, storage);
    await expect(s.eraseUser('u2', { reason: 'r' }, actor)).rejects.toThrow('minio down');
    expect(repo.eraseUser).not.toHaveBeenCalled(); // rows untouched
  });
});

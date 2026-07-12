import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdminService } from './admin.service.js';
import type { AdminRepository } from './admin.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function makeService(overrides: Partial<AdminRepository> = {}) {
  const repo = {
    getSettings: vi.fn().mockResolvedValue({}),
    writeSettings: vi.fn().mockResolvedValue(undefined),
    listAudit: vi.fn(),
    ...overrides,
  } as unknown as AdminRepository;
  return { svc: new AdminService(repo), repo };
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

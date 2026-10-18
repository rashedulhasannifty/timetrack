import { describe, it, expect, vi } from 'vitest';
import { PolicyService } from './policy.service.js';
import type { PolicyRepository } from './policy.repository.js';

function make(row: { monitoringAckAt: Date | null; team: { settings: unknown } } | null) {
  const repo = { getUserPolicy: vi.fn().mockResolvedValue(row) } as unknown as PolicyRepository;
  return new PolicyService(repo);
}

describe('PolicyService.captureContext', () => {
  it('is not acknowledged while monitoringAckAt is null', async () => {
    const ctx = await make({ monitoringAckAt: null, team: { settings: {} } }).captureContext('u1');
    expect(ctx?.acknowledged).toBe(false);
  });

  it('is acknowledged once monitoringAckAt is set, with settings parsed through defaults', async () => {
    const ctx = await make({
      monitoringAckAt: new Date(),
      team: { settings: { captureWindowTitles: false } },
    }).captureContext('u1');
    expect(ctx?.acknowledged).toBe(true);
    expect(ctx?.settings.captureWindowTitles).toBe(false);
    expect(ctx?.settings.screenshotsEnabled).toBe(true); // default
  });

  it('is null for an unknown user', async () => {
    expect(await make(null).captureContext('nobody')).toBeNull();
  });
});

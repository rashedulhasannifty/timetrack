import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'nestjs-pino';
import { ActivityService } from './activity.service.js';
import type { ActivityRepository } from './activity.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { PartitionRangeService } from '../../common/partitions/partition-range.service.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const LOGGER = { warn: vi.fn() } as unknown as Logger;
const query = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

function repoStub() {
  return {
    insertBatch: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue([]),
    listSummaries: vi.fn().mockResolvedValue([]),
  } as unknown as ActivityRepository;
}

describe('ActivityService.list', () => {
  it('lists the target user, defaulting to self when no userId is given', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo, {} as unknown as PartitionRangeService, LOGGER);
    await svc.list(query, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u1' });
  });

  it('lists an explicitly requested user id (guard already authorized it)', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo, {} as unknown as PartitionRangeService, LOGGER);
    await svc.list({ ...query, userId: 'u2' }, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u2' });
  });
});

const summaryQuery = { from: '2026-07-01', to: '2026-07-31' };

describe('ActivityService.listSummaries', () => {
  it('lists the target user, defaulting to self when no userId is given', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo, {} as unknown as PartitionRangeService, LOGGER);
    await svc.listSummaries(summaryQuery, employee);
    expect(repo.listSummaries).toHaveBeenCalledWith({
      userId: 'u1',
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('lists an explicitly requested user id (guard already authorized it)', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo, {} as unknown as PartitionRangeService, LOGGER);
    await svc.listSummaries({ ...summaryQuery, userId: 'u2' }, employee);
    expect(repo.listSummaries).toHaveBeenCalledWith({
      userId: 'u2',
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });
});

describe('ActivityService.ingest', () => {
  const IN = '2026-07-11T09:00:00.000Z';
  const OUT = '2031-01-01T00:00:00.000Z';
  function sample(id: string, timestamp: string) {
    return {
      id,
      timestamp,
      appName: 'Code',
      windowTitle: 'private title',
      activityPct: 50,
      category: 'NEUTRAL' as const,
    };
  }
  function partitions(): PartitionRangeService {
    return {
      acceptor: vi.fn().mockResolvedValue((ts: Date) => ts.toISOString() === IN),
      invalidate: vi.fn(),
    } as unknown as PartitionRangeService;
  }

  it('inserts only in-range samples and logs the dropped count without sample content', async () => {
    const repo = repoStub();
    vi.mocked(repo.insertBatch).mockResolvedValue(1);
    const warn = vi.fn();
    const svc = new ActivityService(repo, partitions(), { warn } as unknown as Logger);

    const res = await svc.ingest({ samples: [sample('a', IN), sample('b', OUT)] }, employee);

    expect(res).toEqual({ accepted: 1 });
    expect(repo.insertBatch).toHaveBeenCalledWith('u1', [sample('a', IN)]);
    expect(warn).toHaveBeenCalledWith(
      { userId: 'u1', received: 2, dropped: 1, oldestDropped: OUT, newestDropped: OUT },
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private title');
  });

  it('skips the insert entirely when nothing is in range', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo, partitions(), LOGGER);
    expect(await svc.ingest({ samples: [sample('b', OUT)] }, employee)).toEqual({ accepted: 0 });
    expect(repo.insertBatch).not.toHaveBeenCalled();
  });

  it('does not log when nothing is dropped', async () => {
    const repo = repoStub();
    const warn = vi.fn();
    const svc = new ActivityService(repo, partitions(), { warn } as unknown as Logger);
    await svc.ingest({ samples: [sample('a', IN)] }, employee);
    expect(warn).not.toHaveBeenCalled();
  });

  it('invalidates the cached partition ranges when the insert fails', async () => {
    const repo = repoStub();
    vi.mocked(repo.insertBatch).mockRejectedValue(new Error('no partition'));
    const p = partitions();
    const svc = new ActivityService(repo, p, LOGGER);
    await expect(svc.ingest({ samples: [sample('a', IN)] }, employee)).rejects.toThrow(
      'no partition',
    );
    expect(p.invalidate).toHaveBeenCalledWith('activity_samples');
  });
});

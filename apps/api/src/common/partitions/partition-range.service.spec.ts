import { describe, it, expect, vi } from 'vitest';
import {
  PartitionRangeService,
  parsePartitionBound,
  PARTITION_RANGE_TTL_MS,
} from './partition-range.service.js';
import type { PartitionRangeRepository } from './partition-range.repository.js';

const JUL = "FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00')";
const AUG = "FOR VALUES FROM ('2026-08-01 00:00:00') TO ('2026-09-01 00:00:00')";
const OCT = "FOR VALUES FROM ('2026-10-01 00:00:00') TO ('2026-11-01 00:00:00')";

function make(bounds: string[]) {
  const repo = {
    listPartitionBounds: vi.fn().mockResolvedValue(bounds),
  } as unknown as PartitionRangeRepository;
  return { svc: new PartitionRangeService(repo), repo };
}

describe('parsePartitionBound', () => {
  it('reads a monthly range as half-open UTC bounds', () => {
    expect(parsePartitionBound(JUL)).toEqual({
      kind: 'range',
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('treats MINVALUE / MAXVALUE as open ends', () => {
    expect(parsePartitionBound("FOR VALUES FROM (MINVALUE) TO ('2026-08-01 00:00:00')")).toEqual({
      kind: 'range',
      from: null,
      to: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(parsePartitionBound("FOR VALUES FROM ('2026-08-01 00:00:00') TO (MAXVALUE)")).toEqual({
      kind: 'range',
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: null,
    });
  });

  it('recognises a DEFAULT partition', () => {
    expect(parsePartitionBound('DEFAULT')).toEqual({ kind: 'default' });
  });

  it('returns null for anything it does not understand (never guesses a range)', () => {
    expect(parsePartitionBound('FOR VALUES IN (1, 2)')).toBeNull();
  });
});

describe('PartitionRangeService.acceptor', () => {
  const NOW = new Date('2026-10-18T12:00:00.000Z');

  it('accepts a timestamp inside any existing partition, including gaps between them', async () => {
    const { svc } = make([JUL, AUG, OCT]);
    const accepts = await svc.acceptor('activity_samples', NOW);
    expect(accepts(new Date('2026-07-11T09:00:00.000Z'))).toBe(true);
    expect(accepts(new Date('2026-08-31T23:59:59.999Z'))).toBe(true);
    expect(accepts(new Date('2026-10-18T11:00:00.000Z'))).toBe(true);
    // September has no partition (e.g. dropped or never created) — Postgres would reject it.
    expect(accepts(new Date('2026-09-15T00:00:00.000Z'))).toBe(false);
  });

  it('rejects a timestamp before the oldest partition (dropped by retention)', async () => {
    const { svc } = make([JUL, AUG, OCT]);
    const accepts = await svc.acceptor('activity_samples', NOW);
    expect(accepts(new Date('2026-06-30T23:59:59.999Z'))).toBe(false);
  });

  it('upper bound is exclusive, like Postgres', async () => {
    const { svc } = make([JUL]);
    const accepts = await svc.acceptor('activity_samples', NOW);
    expect(accepts(new Date('2026-08-01T00:00:00.000Z'))).toBe(false);
  });

  it('rejects anything more than one day in the future even when a partition exists', async () => {
    const { svc } = make([OCT]);
    const accepts = await svc.acceptor('activity_samples', NOW);
    expect(accepts(new Date('2026-10-19T12:00:00.000Z'))).toBe(true); // exactly +1 day
    expect(accepts(new Date('2026-10-19T12:00:00.001Z'))).toBe(false);
    expect(accepts(new Date('2026-10-30T00:00:00.000Z'))).toBe(false);
  });

  it('with a DEFAULT partition every timestamp lands, so only the future cutoff applies', async () => {
    const { svc } = make([JUL, 'DEFAULT']);
    const accepts = await svc.acceptor('screenshots', NOW);
    expect(accepts(new Date('2020-01-01T00:00:00.000Z'))).toBe(true);
    expect(accepts(new Date('2026-12-01T00:00:00.000Z'))).toBe(false);
  });

  it('rejects an invalid date', async () => {
    const { svc } = make([JUL]);
    const accepts = await svc.acceptor('activity_samples', NOW);
    expect(accepts(new Date('nope'))).toBe(false);
  });
});

describe('PartitionRangeService cache', () => {
  it('reads the catalog once per table within the TTL, again after it', async () => {
    const { svc, repo } = make([JUL]);
    const t0 = new Date('2026-10-18T12:00:00.000Z');
    await svc.acceptor('activity_samples', t0);
    await svc.acceptor('activity_samples', new Date(t0.getTime() + PARTITION_RANGE_TTL_MS - 1));
    expect(repo.listPartitionBounds).toHaveBeenCalledTimes(1);

    await svc.acceptor('screenshots', t0); // a separate entry per table
    expect(repo.listPartitionBounds).toHaveBeenCalledTimes(2);

    await svc.acceptor('activity_samples', new Date(t0.getTime() + PARTITION_RANGE_TTL_MS));
    expect(repo.listPartitionBounds).toHaveBeenCalledTimes(3);
  });

  it('concurrent callers share one in-flight catalog read', async () => {
    const { svc, repo } = make([JUL]);
    const now = new Date('2026-10-18T12:00:00.000Z');
    await Promise.all([
      svc.acceptor('activity_samples', now),
      svc.acceptor('activity_samples', now),
    ]);
    expect(repo.listPartitionBounds).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces the next call to re-read the catalog', async () => {
    const { svc, repo } = make([JUL]);
    const now = new Date('2026-10-18T12:00:00.000Z');
    await svc.acceptor('activity_samples', now);
    svc.invalidate('activity_samples');
    await svc.acceptor('activity_samples', now);
    expect(repo.listPartitionBounds).toHaveBeenCalledTimes(2);
  });

  it('a failed catalog read is not cached', async () => {
    const repo = {
      listPartitionBounds: vi
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce([JUL]),
    } as unknown as PartitionRangeRepository;
    const svc = new PartitionRangeService(repo);
    const now = new Date('2026-10-18T12:00:00.000Z');
    await expect(svc.acceptor('activity_samples', now)).rejects.toThrow('db down');
    const accepts = await svc.acceptor('activity_samples', now);
    expect(accepts(new Date('2026-07-11T00:00:00.000Z'))).toBe(true);
  });
});

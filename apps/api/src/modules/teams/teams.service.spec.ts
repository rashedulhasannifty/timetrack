import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service.js';
import type { TeamsRepository } from './teams.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const T1 = '01920000-0000-7000-8000-000000000001';
const T2 = '01920000-0000-7000-8000-000000000002';
const GONE = '01920000-0000-7000-8000-00000000dead';

const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: T1 };

function makeService(overrides: Partial<TeamsRepository> = {}) {
  const repo = {
    getById: vi.fn().mockResolvedValue({ id: T1, name: 'Engineering', settings: {} }),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: T2, name: 'Support', settings: {} }),
    rename: vi.fn().mockResolvedValue({ id: T2, name: 'Customer Support', settings: {} }),
    ...overrides,
  } as unknown as TeamsRepository;
  return { svc: new TeamsService(repo), repo };
}

describe('TeamsService.list', () => {
  it('carries each row’s member count through to the list item', async () => {
    const { svc } = makeService({
      list: vi.fn().mockResolvedValue([
        { id: T1, name: 'Engineering', settings: {}, memberCount: 7, projectCount: 3 },
        { id: T2, name: 'Support', settings: {}, memberCount: 0, projectCount: 0 },
      ]),
    });
    const teams = await svc.list();
    expect(teams.map((t) => [t.name, t.memberCount])).toEqual([
      ['Engineering', 7],
      ['Support', 0],
    ]);
  });

  it('fills a legacy/empty settings column with the schema defaults', async () => {
    // A row whose Json column was never written must still present a complete policy — the
    // Teams surface renders these values directly.
    const { svc } = makeService({
      list: vi
        .fn()
        .mockResolvedValue([
          { id: T1, name: 'Eng', settings: {}, memberCount: 1, projectCount: 0 },
        ]),
    });
    const [team] = await svc.list();
    expect(team?.settings.screenshotIntervalMinutes).toBe(10);
    expect(team?.settings.screenshotsEnabled).toBe(true);
  });
});

describe('TeamsService.rename', () => {
  it('renames the team named in the URL and returns the new name', async () => {
    const { svc, repo } = makeService();
    const team = await svc.rename(T2, { name: 'Customer Support' }, admin);
    expect(repo.rename).toHaveBeenCalledWith(T2, 'Customer Support', 'a1');
    expect(team.name).toBe('Customer Support');
  });

  it('404s when the team is gone rather than creating one', async () => {
    const { svc } = makeService({ rename: vi.fn().mockResolvedValue(null) });
    await expect(svc.rename(GONE, { name: 'Whatever' }, admin)).rejects.toThrow(NotFoundException);
  });
});

describe('TeamsService.create', () => {
  it('merges a partial settings patch over the defaults before persisting', async () => {
    // The admin sent one field; every other field must still be written at its default, not
    // left absent — a half-populated Json blob is what TeamSettingsSchema exists to prevent.
    const { svc, repo } = makeService();
    await svc.create({ name: 'Support', settings: { screenshotsEnabled: false } }, admin);
    const written = vi.mocked(repo.create).mock.calls[0]?.[1];
    expect(written?.screenshotsEnabled).toBe(false);
    expect(written?.screenshotIntervalMinutes).toBe(10);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { WorkTypesService } from './work-types.service.js';
import type { WorkTypesRepository } from './work-types.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const W1 = '01920000-0000-7000-8000-000000000001';
const W2 = '01920000-0000-7000-8000-000000000002';
const T2 = '01920000-0000-7000-8000-0000000000c2';

function makeService(overrides: Partial<WorkTypesRepository> = {}) {
  const repo = {
    listWithTeams: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([{ id: W1, name: 'Payroll', archived: false }]),
    findByIds: vi.fn().mockResolvedValue([]),
    teamExists: vi.fn().mockResolvedValue(true),
    createMany: vi
      .fn()
      .mockImplementation((names: string[]) =>
        Promise.resolve(names.map((name, i) => ({ id: `new-${i}`, name, archived: false }))),
      ),
    update: vi.fn().mockResolvedValue({ id: W1, name: 'Payroll', archived: false }),
    setTeamSelection: vi.fn().mockResolvedValue({ teamId: T2, workTypeIds: [] }),
    resync: vi.fn(),
    ...overrides,
  } as unknown as WorkTypesRepository;
  return { svc: new WorkTypesService(repo), repo };
}

beforeEach(() => vi.clearAllMocks());

describe('WorkTypesService.bulkCreate', () => {
  it('creates new names and skips reserved, existing, repeated and bad ones with reasons', async () => {
    const { svc, repo } = makeService();
    const result = await svc.bulkCreate(
      { names: ['Bookkeeping', 'payroll', 'GENERAL', 'bookkeeping', '  ', 'AdHoc'] },
      admin,
    );
    expect(repo.createMany).toHaveBeenCalledWith(['Bookkeeping', 'AdHoc'], 'a1');
    expect(result.created.map((w) => w.name)).toEqual(['Bookkeeping', 'AdHoc']);
    expect(result.skipped).toEqual([
      { name: 'payroll', reason: 'Already in the catalog' },
      { name: 'GENERAL', reason: 'Reserved name' },
      { name: 'bookkeeping', reason: 'Duplicate in list' },
      { name: '  ', reason: 'Empty name' },
    ]);
  });

  it('skips empty and over-long names with a reason', async () => {
    const { svc } = makeService();
    const long = 'z'.repeat(201);
    const result = await svc.bulkCreate({ names: [long] }, admin);
    expect(result).toEqual({
      created: [],
      skipped: [{ name: long, reason: 'Longer than 200 characters' }],
    });
  });

  it('does not call the repository when nothing is left to create', async () => {
    const { svc, repo } = makeService();
    await svc.bulkCreate({ names: ['Payroll'] }, admin);
    expect(repo.createMany).not.toHaveBeenCalled();
  });
});

describe('WorkTypesService.update', () => {
  it('409s a rename to General in any case (ruling R14)', async () => {
    const { svc, repo } = makeService();
    await expect(svc.update(W1, { name: 'general' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('409s a rename that collides case-insensitively with another work type', async () => {
    const { svc } = makeService({
      listAll: vi.fn().mockResolvedValue([
        { id: W1, name: 'Payroll', archived: false },
        { id: W2, name: 'AdHoc', archived: false },
      ]),
    });
    await expect(svc.update(W2, { name: 'PAYROLL' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows re-casing its own name, normalized', async () => {
    const { svc, repo } = makeService();
    await svc.update(W1, { name: '  PAYROLL ' }, admin);
    expect(repo.update).toHaveBeenCalledWith(W1, { name: 'PAYROLL' }, 'a1');
  });

  it('422s a name that is empty once normalized', async () => {
    const { svc } = makeService();
    await expect(svc.update(W1, { name: '&nbsp;' }, admin)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('passes an archive-only patch without reading the catalog', async () => {
    const { svc, repo } = makeService();
    await svc.update(W1, { archived: true }, admin);
    expect(repo.listAll).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(W1, { archived: true }, 'a1');
  });

  it('404s when the work type is gone', async () => {
    const { svc } = makeService({ update: vi.fn().mockResolvedValue(null) });
    await expect(svc.update(W1, { archived: true }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('WorkTypesService.setTeamSelection', () => {
  it('404s an unknown team', async () => {
    const { svc, repo } = makeService({ teamExists: vi.fn().mockResolvedValue(false) });
    await expect(svc.setTeamSelection(T2, { workTypeIds: [] }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.setTeamSelection).not.toHaveBeenCalled();
  });

  it('404s when any id is unknown', async () => {
    const { svc } = makeService({ findByIds: vi.fn().mockResolvedValue([]) });
    await expect(svc.setTeamSelection(T2, { workTypeIds: [W1] }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('422s when any id is archived', async () => {
    const { svc } = makeService({
      findByIds: vi.fn().mockResolvedValue([{ id: W1, name: 'Payroll', archived: true }]),
    });
    await expect(svc.setTeamSelection(T2, { workTypeIds: [W1] }, admin)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('de-duplicates ids before saving', async () => {
    const { svc, repo } = makeService({
      findByIds: vi.fn().mockResolvedValue([{ id: W1, name: 'Payroll', archived: false }]),
    });
    await svc.setTeamSelection(T2, { workTypeIds: [W1, W1] }, admin);
    expect(repo.findByIds).toHaveBeenCalledWith([W1]);
    expect(repo.setTeamSelection).toHaveBeenCalledWith(T2, [W1], 'a1');
  });
});

describe('WorkTypesService.resync / list', () => {
  it('delegates with the actor id and returns the counts', async () => {
    const counts = { projects: 3, created: 1, linked: 0, restored: 0, renamed: 0, archived: 0 };
    const { svc, repo } = makeService({ resync: vi.fn().mockResolvedValue(counts) });
    await expect(svc.resync(admin)).resolves.toEqual(counts);
    expect(repo.resync).toHaveBeenCalledWith('a1');
    await svc.list();
    expect(repo.listWithTeams).toHaveBeenCalled();
  });
});

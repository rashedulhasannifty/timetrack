import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listProjects } = vi.hoisted(() => ({ listProjects: vi.fn() }));

vi.mock('../../lib/api-client', () => ({
  api: {
    listTimeEntries: vi.fn().mockResolvedValue([]),
    listActivitySamples: vi.fn().mockResolvedValue([]),
    listScreenshots: vi.fn().mockResolvedValue([]),
    listProjects,
    appUsage: vi.fn().mockResolvedValue(null),
    trends: vi.fn().mockResolvedValue(null),
    listIdleEvents: vi.fn().mockResolvedValue([]),
    teamOverview: vi.fn().mockResolvedValue({ date: '2026-09-30', rows: [] }),
  },
}));

import { loadPersonDay } from './PersonDayContent';

const base = { token: 'tok', userId: 'u1', rawDate: '2026-09-30', rawPanel: undefined };

beforeEach(() => {
  listProjects.mockReset().mockResolvedValue([]);
});

describe('loadPersonDay project names', () => {
  // Regression: the names were read from the viewer's OWN team only, so an admin opening
  // someone in another team saw every entry as "Untitled entry" despite a project being set.
  it('reads every team’s projects for an ADMIN', async () => {
    await loadPersonDay({ ...base, viewerRole: 'ADMIN' });
    expect(listProjects).toHaveBeenCalledWith('tok', { includeArchived: true, allTeams: true });
  });

  // allTeams is ADMIN-only server-side; a MANAGER asking for it gets a 403 and no names at all.
  it('keeps a MANAGER on their own team’s projects', async () => {
    await loadPersonDay({ ...base, viewerRole: 'MANAGER' });
    expect(listProjects).toHaveBeenCalledWith('tok', { includeArchived: true });
  });
});

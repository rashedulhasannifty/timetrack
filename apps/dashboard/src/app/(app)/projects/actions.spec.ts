import { describe, it, expect, vi, beforeEach } from 'vitest';

const { revalidatePath, getSession, getCurrentTeam, createProject } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getSession: vi.fn(),
  getCurrentTeam: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../../../lib/session', () => ({ getSession }));
vi.mock('../../../lib/api-client', () => ({
  api: { getCurrentTeam, createProject },
  ApiError: class ApiError extends Error {},
}));

import { createProjectAction } from './actions';

const ENGINEERING = '018f9c1e-0000-7000-8000-000000000001';
const BPO = '018f9c1e-0000-7000-8000-000000000002';
const INITIAL = { ok: false };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: 'u1', role: 'ADMIN', accessToken: 'tok' });
  getCurrentTeam.mockResolvedValue({ id: ENGINEERING, name: 'Engineering' });
  createProject.mockResolvedValue({});
});

describe('createProjectAction', () => {
  // Regression: an admin with BPO selected in the team picker got the project in their own
  // team (Engineering), because the action always asked the API for the caller's current team.
  it('creates in the team named by the form, not the caller’s own team', async () => {
    const res = await createProjectAction(
      INITIAL,
      form({ teamId: BPO, name: 'Payroll', color: '#007aff' }),
    );
    expect(res).toEqual({ ok: true });
    expect(createProject).toHaveBeenCalledWith('tok', {
      teamId: BPO,
      name: 'Payroll',
      color: '#007aff',
    });
    expect(getCurrentTeam).not.toHaveBeenCalled();
  });

  it('falls back to the caller’s own team when the form names none', async () => {
    const res = await createProjectAction(
      INITIAL,
      form({ teamId: '', name: 'Website', color: '#007aff' }),
    );
    expect(res).toEqual({ ok: true });
    expect(createProject).toHaveBeenCalledWith('tok', {
      teamId: ENGINEERING,
      name: 'Website',
      color: '#007aff',
    });
  });

  it('refuses an EMPLOYEE without calling the API', async () => {
    getSession.mockResolvedValue({ userId: 'u2', role: 'EMPLOYEE', accessToken: 'tok' });
    const res = await createProjectAction(
      INITIAL,
      form({ teamId: BPO, name: 'Payroll', color: '#007aff' }),
    );
    expect(res).toEqual({ ok: false, message: 'Not authorized.' });
    expect(createProject).not.toHaveBeenCalled();
  });
});

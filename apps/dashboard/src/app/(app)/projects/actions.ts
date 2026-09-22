'use server';

import { revalidatePath } from 'next/cache';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
} from '@timetrack/contracts';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';

export interface ProjectActionState {
  ok: boolean;
  message?: string;
  /** Set on success only, by the archive/restore toggles — the toast text depends on it. */
  archived?: boolean;
}

// NOTE: a 'use server' module may export ONLY async functions (and types, which are erased).
// Do NOT export a value/const here — components define their own INITIAL locally.

function canManage(role: string): boolean {
  return role === 'MANAGER' || role === 'ADMIN';
}

/**
 * Create a project in the team the index is showing. The team comes from the form (the ADMIN
 * team picker) and falls back to the caller's own team when absent — it used to ALWAYS be the
 * caller's own team, so an admin creating "in BPO" silently created in their home team. The API
 * re-checks that a MANAGER can only create in their own team.
 */
export async function createProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawTeam = formData.get('teamId');
  const teamId =
    typeof rawTeam === 'string' && rawTeam.length > 0
      ? rawTeam
      : (await api.getCurrentTeam(session.accessToken)).id;
  const parsed = CreateProjectSchema.safeParse({
    teamId,
    name: formData.get('name'),
    color: formData.get('color'),
  });
  if (!parsed.success) return { ok: false, message: 'Enter a name and pick a color.' };

  try {
    await api.createProject(session.accessToken, parsed.data);
    revalidatePath('/projects');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : 'Could not create the project.',
    };
  }
}

export async function archiveProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const archived = formData.get('archived') === 'true';
  const parsed = UpdateProjectSchema.safeParse({ archived });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid request.' };

  try {
    await api.archiveProject(session.accessToken, id, archived);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    return { ok: true, archived };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

export async function recolorProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = UpdateProjectSchema.safeParse({ color: formData.get('color') });
  if (!id || !parsed.success || parsed.data.color === undefined) {
    return { ok: false, message: 'Pick a color.' };
  }

  try {
    await api.recolorProject(session.accessToken, id, parsed.data.color);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Recolor failed.' };
  }
}

/**
 * Move a project to another team. ADMIN only — the API 403s a MANAGER moving a project across
 * teams, so a MANAGER is refused here rather than after a round trip. Hours already tracked stay
 * with the team whose people tracked them; the move changes who can pick and administer it.
 */
export async function moveProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = UpdateProjectSchema.safeParse({ teamId: formData.get('teamId') });
  if (!id || !parsed.success || parsed.data.teamId === undefined) {
    return { ok: false, message: 'Pick a team.' };
  }

  try {
    await api.moveProject(session.accessToken, id, parsed.data.teamId);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Move failed.' };
  }
}

export async function createTaskAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawProjectId = formData.get('projectId');
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const parsed = CreateTaskSchema.safeParse({ projectId, name: formData.get('name') });
  if (!parsed.success) return { ok: false, message: 'Enter a task name.' };

  try {
    await api.createTask(session.accessToken, parsed.data);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not add the task.' };
  }
}

export async function archiveTaskAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const rawProjectId = formData.get('projectId');
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const archived = formData.get('archived') === 'true';
  const parsed = UpdateTaskSchema.safeParse({ archived });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid request.' };

  try {
    await api.archiveTask(session.accessToken, id, archived);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true, archived };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

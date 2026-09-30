'use server';

import { revalidatePath } from 'next/cache';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  SetProjectTeamsSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateSubprojectSchema,
  UpdateSubprojectSchema,
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
    // The Clients & work types table moves projects with this same control.
    revalidatePath('/admin/catalog');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Move failed.' };
  }
}

export async function setProjectTeamsAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = SetProjectTeamsSchema.safeParse({
    teamIds: formData.getAll('teamId').filter((v): v is string => typeof v === 'string'),
  });
  if (!id || !parsed.success) return { ok: false, message: 'Could not save the teams.' };

  try {
    await api.setProjectTeams(session.accessToken, id, parsed.data);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    revalidatePath('/admin/catalog');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not save the teams.' };
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
  const parsed = CreateTaskSchema.safeParse({
    subprojectId: formData.get('subprojectId'),
    name: formData.get('name'),
  });
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

export async function createSubprojectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const parsed = CreateSubprojectSchema.safeParse({
    projectId: formData.get('projectId'),
    name: formData.get('name'),
  });
  if (!parsed.success) return { ok: false, message: 'Enter a subproject name.' };

  try {
    await api.createSubproject(session.accessToken, parsed.data);
    revalidatePath(`/projects/${parsed.data.projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : 'Could not add the subproject.',
    };
  }
}

export async function archiveSubprojectAction(
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
  const parsed = UpdateSubprojectSchema.safeParse({ archived });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid request.' };

  try {
    await api.archiveSubproject(session.accessToken, id, archived);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true, archived };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

export async function moveTaskAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const rawProjectId = formData.get('projectId');
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const parsed = UpdateTaskSchema.safeParse({ subprojectId: formData.get('subprojectId') });
  if (!id || !parsed.success || parsed.data.subprojectId === undefined) {
    return { ok: false, message: 'Pick a subproject.' };
  }

  try {
    await api.moveTask(session.accessToken, id, parsed.data.subprojectId);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Move failed.' };
  }
}

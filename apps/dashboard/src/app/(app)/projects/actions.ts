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
}

// NOTE: a 'use server' module may export ONLY async functions (and types, which are erased).
// Do NOT export a value/const here — components define their own INITIAL locally.

function canManage(role: string): boolean {
  return role === 'MANAGER' || role === 'ADMIN';
}

export async function createProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const team = await api.getCurrentTeam(session.accessToken);
  const parsed = CreateProjectSchema.safeParse({
    teamId: team.id,
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
    return { ok: true };
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
    return { ok: false, message: 'Pick a palette color.' };
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
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { UpdateWorkTypeSchema, parseNameList, type NameSkip } from '@timetrack/contracts';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { describeCounts, describeTeamSave, teamSaveDiff } from '../../../../lib/catalog-view';

/** Result of a catalog form, surfaced through useToastAction. */
export interface CatalogState {
  ok: boolean;
  message?: string;
  created?: string[];
  skipped?: NameSkip[];
}

const PATH = '/admin/catalog';

/** ADMIN only (spec §2). The API 403s anyone else too; this keeps the message human. */
async function adminToken(): Promise<string | null> {
  const session = await getSession();
  return session && session.role === 'ADMIN' ? session.accessToken : null;
}

function failure(e: unknown, fallback: string): CatalogState {
  return { ok: false, message: e instanceof ApiError ? e.message : fallback };
}

const text = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export async function addWorkTypesAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const names = parseNameList(text(formData.get('names')));
  if (names.length === 0) return { ok: false, message: 'Paste at least one name.' };
  if (names.length > 100) {
    return { ok: false, message: `That is ${names.length} names; add at most 100 at a time.` };
  }
  try {
    const result = await api.bulkCreateWorkTypes(token, { names });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `${result.created.length} added, ${result.skipped.length} skipped`,
      created: result.created.map((w) => w.name),
      skipped: result.skipped,
    };
  } catch (e) {
    return failure(e, 'Could not add the work types.');
  }
}

export async function renameWorkTypeAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const id = text(formData.get('id'));
  const parsed = UpdateWorkTypeSchema.safeParse({ name: formData.get('name') });
  if (!id || !parsed.success) return { ok: false, message: 'Enter a name (1–200 characters).' };
  try {
    await api.updateWorkType(token, id, parsed.data);
    revalidatePath(PATH);
    return { ok: true, message: 'Work type renamed' };
  } catch (e) {
    return failure(e, 'Could not rename the work type.');
  }
}

export async function setWorkTypeArchivedAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const id = text(formData.get('id'));
  const archived = text(formData.get('archived')) === 'true';
  if (!id) return { ok: false, message: 'No work type selected.' };
  try {
    await api.updateWorkType(token, id, { archived });
    revalidatePath(PATH);
    return { ok: true, message: archived ? 'Work type archived' : 'Work type restored' };
  } catch (e) {
    return failure(e, archived ? 'Could not archive.' : 'Could not restore.');
  }
}

/**
 * Save one team column. The diff is computed against a FRESH catalog read, so a stale page
 * never re-sends ids someone archived meanwhile (ruling R5); an unchanged column sends nothing.
 */
export async function saveTeamWorkTypesAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const teamId = text(formData.get('teamId'));
  const teamName = text(formData.get('teamName')) || 'Team';
  if (!teamId) return { ok: false, message: 'No team selected.' };
  const submitted = formData.getAll('workTypeId').filter((v): v is string => typeof v === 'string');
  try {
    const diff = teamSaveDiff(await api.listWorkTypes(token), teamId, submitted);
    if (diff.changed) {
      await api.setTeamWorkTypes(token, teamId, { workTypeIds: diff.workTypeIds });
      revalidatePath(PATH);
    }
    return { ok: true, message: describeTeamSave(diff, teamName) };
  } catch (e) {
    return failure(e, `Could not save ${teamName}.`);
  }
}

export async function importClientsAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const teamId = text(formData.get('teamId'));
  if (!teamId) return { ok: false, message: 'Pick a team.' };
  const names = parseNameList(text(formData.get('names')));
  if (names.length === 0) return { ok: false, message: 'Paste at least one client name.' };
  if (names.length > 500) {
    return { ok: false, message: `That is ${names.length} names; import at most 500 at a time.` };
  }
  try {
    const result = await api.bulkCreateProjects(token, { teamId, names });
    revalidatePath(PATH);
    revalidatePath('/projects');
    return {
      ok: true,
      message: `${result.created.length} imported, ${result.skipped.length} skipped`,
      created: result.created.map((p) => p.name),
      skipped: result.skipped,
    };
  } catch (e) {
    return failure(e, 'Could not import the clients.');
  }
}

export async function resyncAction(
  _prev: CatalogState,
  _formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  try {
    const counts = await api.resyncWorkTypes(token);
    revalidatePath(PATH);
    return { ok: true, message: describeCounts(counts) };
  } catch (e) {
    return failure(e, 'Re-sync failed.');
  }
}

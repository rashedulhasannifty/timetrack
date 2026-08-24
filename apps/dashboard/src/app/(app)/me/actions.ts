'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { IdleEventSchema, RedactScreenshotSchema } from '@timetrack/contracts';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { optionalId, optionalText, parseEntryTimes, textField } from '../../../lib/entry-form';

export type RedactResult = { ok: true } | { ok: false; error: string };

/**
 * Employee redacts their own screenshot. Runs server-side so the access token never
 * reaches the browser (CLAUDE.md §4). Owner-only + idempotency are enforced by the API;
 * here we trim + require a non-empty reason (the server re-validates via the same schema).
 * On success we revalidate /me so the tile re-renders as a REDACTED tombstone.
 */
export async function redactScreenshotAction(id: string, reason: string): Promise<RedactResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Not signed in.' };

  const parsed = RedactScreenshotSchema.safeParse({ reason: reason.trim() });
  if (!parsed.success) return { ok: false, error: 'A reason is required.' };

  try {
    await api.redactScreenshot(session.accessToken, id, parsed.data);
    revalidatePath('/me');
    return { ok: true };
  } catch {
    // Never surface raw API/error text to the browser.
    return { ok: false, error: 'Could not redact — try again.' };
  }
}

export type ResolveIdleState = { ok: boolean; message?: string };

/**
 * Employee resolves one of their own idle periods: KEPT counts the stretch as tracked time,
 * DISCARDED drops the overlapping auto-tracked time (PRD §6.1/§6.4). Nothing is deleted either
 * way -- the row stays, with a different resolution.
 *
 * There is no dedicated resolve endpoint. `POST /idle-events` is an idempotent upsert on the
 * event's own id, so re-posting it with a new resolvedAction IS the resolve. The API attributes
 * the row to the caller, which is why this action is self-only and why the manager's view of
 * someone else's periods stays read-only.
 *
 * The window is re-sent unchanged from the row the page rendered; the upsert's update branch
 * writes endTime and resolvedAction, so sending the original endTime leaves it untouched.
 */
export async function resolveIdleAction(
  _prev: ResolveIdleState,
  formData: FormData,
): Promise<ResolveIdleState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in.' };

  const parsed = IdleEventSchema.safeParse({
    id: formData.get('id'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    resolvedAction: formData.get('resolvedAction'),
  });
  if (!parsed.success) return { ok: false, message: 'Could not resolve that period.' };

  try {
    await api.upsertIdleEvent(session.accessToken, parsed.data);
    revalidatePath('/me');
    return { ok: true };
  } catch {
    // Never surface raw API/error text to the browser.
    return { ok: false, message: 'Could not save — try again.' };
  }
}

export type EntryFormState = { ok: boolean; message?: string };

/**
 * The API's problem+json `title` is written for a person and carries the only thing that makes
 * a rejection actionable — "overlaps another entry", "ends in the future". A 4xx is the server
 * telling the user something; anything else is ours to own and must not leak.
 */
function surface(err: unknown, fallback: string): EntryFormState {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
    return { ok: false, message: err.message };
  }
  return { ok: false, message: fallback };
}

/**
 * Both day surfaces render the same entry controls, so a write has to refresh whichever one
 * the user is on. Revalidating both is cheaper than threading the current path through every
 * form, and a manager filing time for someone else changes /me for that person anyway.
 */
function revalidateDayViews(userId?: string): void {
  revalidatePath('/me');
  if (userId) revalidatePath(`/people/${userId}`);
}

/** File a span the person worked but did not track — the "I forgot to hit Start" path. */
export async function createManualEntryAction(
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in.' };

  const times = parseEntryTimes(
    textField(formData.get('day')),
    textField(formData.get('start')),
    textField(formData.get('end')),
  );
  if (!times.ok) return { ok: false, message: times.message };

  // Whose day this is. Absent means the signed-in user; the API authorizes anything else
  // through the same self / manager-of-team / admin rule an edit uses.
  const userId = optionalId(formData.get('userId'));

  try {
    await api.createManualTimeEntry(session.accessToken, {
      id: randomUUID(),
      ...(userId ? { userId } : {}),
      projectId: optionalId(formData.get('projectId')),
      taskId: optionalId(formData.get('taskId')),
      startTime: times.startTime,
      endTime: times.endTime,
      ...(optionalText(formData.get('note')) !== undefined
        ? { note: optionalText(formData.get('note'))! }
        : {}),
    });
    revalidateDayViews(userId ?? undefined);
    return { ok: true };
  } catch (err) {
    return surface(err, 'Could not add that entry — try again.');
  }
}

/** Correct the times, project or note on an existing entry. */
export async function updateEntryAction(
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in.' };

  const id = textField(formData.get('id'));
  if (!id) return { ok: false, message: 'Nothing to edit.' };

  const times = parseEntryTimes(
    textField(formData.get('day')),
    textField(formData.get('start')),
    textField(formData.get('end')),
  );
  if (!times.ok) return { ok: false, message: times.message };

  try {
    await api.updateTimeEntry(session.accessToken, id, {
      projectId: optionalId(formData.get('projectId')),
      taskId: optionalId(formData.get('taskId')),
      startTime: times.startTime,
      endTime: times.endTime,
      note: optionalText(formData.get('note')) ?? '',
    });
    revalidateDayViews(optionalId(formData.get('userId')) ?? undefined);
    return { ok: true };
  } catch (err) {
    return surface(err, 'Could not save that change — try again.');
  }
}

/**
 * Remove an entry entirely. The API writes an AuditLog row carrying the whole deleted entry in
 * the same transaction, so this is recoverable by an admin reading the log — but it is not
 * undoable from here, which is why the control behind it is a two-step disclosure.
 */
export async function deleteEntryAction(
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in.' };

  const id = textField(formData.get('id'));
  if (!id) return { ok: false, message: 'Nothing to delete.' };

  try {
    await api.deleteTimeEntry(session.accessToken, id);
    revalidateDayViews(optionalId(formData.get('userId')) ?? undefined);
    return { ok: true };
  } catch (err) {
    return surface(err, 'Could not delete that entry — try again.');
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { IdleEventSchema, RedactScreenshotSchema } from '@timetrack/contracts';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';

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

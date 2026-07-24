'use client';

import { useActionState } from 'react';
import type { Role } from '@timetrack/contracts';
import { setUserRoleAction, type RowState } from './actions';

const INITIAL: RowState = { ok: false };

/**
 * Per-row role picker (slice 4.5). Client component so an API rejection (self-role-change or
 * last-active-admin 409, cross-team 403) is shown next to the control instead of throwing.
 * Submits on change; on error the DB is unchanged and the message surfaces inline.
 */
export function RoleSelect({ userId, role }: { userId: string; role: Role }) {
  const [state, formAction, pending] = useActionState(setUserRoleAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        disabled={pending}
        aria-label="Role"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="bg-surface border-separator text-text focus:border-accent rounded-md border px-2 py-1 text-caption outline-none transition-colors disabled:opacity-50"
      >
        <option value="EMPLOYEE">Employee</option>
        <option value="MANAGER">Manager</option>
        <option value="ADMIN">Admin</option>
      </select>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}

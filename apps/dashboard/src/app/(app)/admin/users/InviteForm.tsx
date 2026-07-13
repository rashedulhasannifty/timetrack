'use client';

import { useActionState } from 'react';
import { inviteUserAction, type InviteState } from './actions';

const INITIAL: InviteState = { ok: false };

/**
 * Invite form. Client component so it can render the action's result inline (success message
 * and, in development, the invite token needed to complete the accept-invite flow) without a
 * full navigation. The action runs server-side and holds the token.
 */
export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteUserAction, INITIAL);

  return (
    <form
      action={formAction}
      className="mb-6 flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row sm:items-end"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-500">Name</span>
        <input
          name="name"
          required
          placeholder="Ada Lovelace"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-500">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="ada@company.com"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-500">Role</span>
        <select
          name="role"
          defaultValue="EMPLOYEE"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="EMPLOYEE">Employee</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Inviting…' : 'Invite'}
      </button>

      {state.message ? (
        <p
          className={`w-full text-sm ${state.ok ? 'text-green-700' : 'text-red-700'}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      {state.devToken ? (
        <p className="w-full text-xs text-neutral-500">
          Dev invite token (development only):{' '}
          <code className="break-all rounded bg-neutral-100 px-1 py-0.5">{state.devToken}</code>
        </p>
      ) : null}
    </form>
  );
}

'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  columnSubmission,
  columnTicks,
  syncColumnTicks,
  toggleColumnTick,
  type CatalogMatrix,
  type ColumnTicks,
} from '../../../../lib/catalog-view';

type TeamColumnsValue = {
  ticks: ColumnTicks;
  toggle: (teamId: string, workTypeId: string, checked: boolean) => void;
  submission: (teamId: string) => string[];
};

const TeamColumnsContext = createContext<TeamColumnsValue | null>(null);

function useTeamColumns(): TeamColumnsValue {
  const value = useContext(TeamColumnsContext);
  if (!value) throw new Error('TeamColumns components must render inside TeamColumnsProvider');
  return value;
}

/**
 * Holds every team column's ticks in client state. The checkboxes are controlled and belong to
 * no form, so React 19's post-action form reset cannot revert them: after a FAILED save the
 * admin's ticks stay, and fresh server props after a successful save replace only that column.
 */
export function TeamColumnsProvider({
  matrix,
  children,
}: {
  matrix: CatalogMatrix;
  children: ReactNode;
}) {
  const server = columnTicks(matrix);
  const serverKey = JSON.stringify(server);
  const [state, setState] = useState({ server, serverKey, ticks: server });

  // Adjust state while rendering when the server props change (React's documented pattern).
  let current = state;
  if (state.serverKey !== serverKey) {
    current = { server, serverKey, ticks: syncColumnTicks(state.server, server, state.ticks) };
    setState(current);
  }

  const value: TeamColumnsValue = {
    ticks: current.ticks,
    toggle: (teamId, workTypeId, checked) =>
      setState((s) => ({ ...s, ticks: toggleColumnTick(s.ticks, teamId, workTypeId, checked) })),
    submission: (teamId) => columnSubmission(matrix, current.ticks, teamId),
  };
  return <TeamColumnsContext.Provider value={value}>{children}</TeamColumnsContext.Provider>;
}

/** One cell of the matrix. Controlled; has no `name`, so it is never submitted or reset. */
export function WorkTypeTick({
  teamId,
  workTypeId,
  disabled,
  label,
}: {
  teamId: string;
  workTypeId: string;
  disabled: boolean;
  label: string;
}) {
  const { ticks, toggle } = useTeamColumns();
  return (
    <input
      type="checkbox"
      checked={ticks[teamId]?.includes(workTypeId) ?? false}
      onChange={(e) => toggle(teamId, workTypeId, e.target.checked)}
      disabled={disabled}
      aria-label={label}
      className="accent-accent h-4 w-4"
    />
  );
}

/** The column's ticked ids as hidden inputs, for its Save form to submit. */
export function ColumnSubmission({ teamId }: { teamId: string }) {
  const { submission } = useTeamColumns();
  return (
    <>
      {submission(teamId).map((id) => (
        <input key={id} type="hidden" name="workTypeId" value={id} />
      ))}
    </>
  );
}

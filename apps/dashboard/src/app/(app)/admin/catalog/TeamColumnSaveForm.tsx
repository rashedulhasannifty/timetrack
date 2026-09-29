'use client';

import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { saveTeamWorkTypesAction, type CatalogState } from './actions';
import { ColumnSubmission } from './TeamColumns';

const INITIAL: CatalogState = { ok: false };

/**
 * The Save for one team column. The column's checkboxes live in the table body; their ticks are
 * client state (TeamColumnsProvider) submitted here as hidden inputs, so each column saves as its
 * own PUT and a failed save does not reset what the admin ticked.
 */
export function TeamColumnSaveForm({
  formId,
  teamId,
  teamName,
}: {
  formId: string;
  teamId: string;
  teamName: string;
}) {
  const [state, formAction, pending] = useToastAction(
    saveTeamWorkTypesAction,
    INITIAL,
    (s) => s.message ?? `${teamName} saved`,
  );
  return (
    <form id={formId} action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="teamName" value={teamName} />
      <ColumnSubmission teamId={teamId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : `Save ${teamName}`}
      </Button>
      {!state.ok && state.message ? (
        <p className="text-destructive text-caption" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

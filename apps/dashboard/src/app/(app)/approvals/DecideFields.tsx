import { Button } from '../../../components/ui/Button';

/**
 * Note field + Approve/Flag buttons + inline error, shared by the row's Decide popover
 * (`DecideForm`) and the week drawer's footer form (`DrawerDecideForm`). Each caller owns its
 * own `<form action={...}>` — the popover is fixed-positioned and the drawer footer is plain
 * flow, so their layouts differ — this is only what goes inside it.
 */
export function DecideFields({
  approvalId,
  pending,
  message,
}: {
  approvalId: string;
  pending: boolean;
  // Not optional: both callers always pass `state.message`, which `exactOptionalPropertyTypes`
  // types as `string | undefined` (DecideState.message is itself optional) — an optional prop
  // here would reject that assignment (TS2375), since exactOptionalPropertyTypes distinguishes
  // "absent" from "present and undefined".
  message: string | undefined;
}) {
  return (
    <>
      <input type="hidden" name="id" value={approvalId} />
      <input
        type="text"
        name="note"
        placeholder="Note (optional)"
        maxLength={2000}
        className="bg-surface border-separator text-text focus:border-accent w-full rounded-md border px-2 py-1 text-caption outline-none"
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          name="status"
          value="APPROVED"
          variant="primary"
          size="sm"
          disabled={pending}
        >
          Approve
        </Button>
        <Button
          type="submit"
          name="status"
          value="FLAGGED"
          variant="secondary"
          size="sm"
          disabled={pending}
        >
          Flag for payroll
        </Button>
      </div>
      {message ? <span className="text-destructive text-caption">{message}</span> : null}
    </>
  );
}

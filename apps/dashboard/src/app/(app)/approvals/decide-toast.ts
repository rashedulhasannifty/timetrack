import type { DecideState } from './actions';

/**
 * Task 1 — toast text for a decided timesheet. The message depends on which button was
 * pressed (approve vs flag), so it reads `status` off the action's own validated result
 * rather than guessing from anything in the client.
 */
export function decideToastMessage(state: DecideState): string {
  return state.status === 'FLAGGED' ? 'Timesheet flagged' : 'Timesheet approved';
}

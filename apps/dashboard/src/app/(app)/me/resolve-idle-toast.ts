import type { ResolveIdleState } from './actions';

/**
 * Task 1 — toast text for a resolved idle period. The message depends on which button was
 * pressed (keep vs discard), so it reads `resolvedAction` off the action's own validated
 * result rather than guessing from anything in the client.
 */
export function resolveIdleToastMessage(state: ResolveIdleState): string {
  return state.resolvedAction === 'DISCARDED' ? 'Idle time discarded' : 'Idle time kept';
}

import type { ProjectActionState } from './actions';

/**
 * Task 1 — toast text for an archive/restore toggle, shared by the project and task rows. The
 * message depends on which state the row is heading to, so it reads `archived` off the
 * action's own validated result rather than guessing from anything in the client.
 */
export function archiveToastMessage(noun: 'Project' | 'Task', state: ProjectActionState): string {
  return `${noun} ${state.archived ? 'archived' : 'restored'}`;
}

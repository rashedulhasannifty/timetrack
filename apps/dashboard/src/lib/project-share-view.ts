/** Linked teams that a save would unlink: currently linked, absent from the submitted set. */
export function removedTeamIds(
  linkedTeamIds: readonly string[],
  selectedTeamIds: readonly string[],
): string[] {
  const selected = new Set(selectedTeamIds);
  return linkedTeamIds.filter((id) => !selected.has(id));
}

/** Confirm wording for unlinking teams from a client (title on the first line, then the body). */
export function describeShareRemoval(teamNames: readonly string[]): string {
  const list = teamNames.join(', ');
  const noun = teamNames.length === 1 ? 'team' : 'teams';
  return [
    `Remove ${list} from this client?`,
    '',
    `The work-type subprojects for the ${noun} (${list}) on this client will be archived. Re-sharing the client restores them.`,
    '',
    'Time already tracked is kept.',
  ].join('\n');
}

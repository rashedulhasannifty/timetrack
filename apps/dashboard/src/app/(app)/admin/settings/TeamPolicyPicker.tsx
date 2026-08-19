import Link from 'next/link';
import type { TeamListItem } from '@timetrack/contracts';

/**
 * Which team's monitoring policy is being edited. Plain links rather than a <select> + client
 * handler: the selection is a URL, so it is shareable, back-button-correct, and needs no
 * JavaScript — and a Server Component can render it directly.
 *
 * Hidden on a single-team deployment. A picker with one option is noise, and the great
 * majority of installs never create a second team.
 */
export function TeamPolicyPicker({
  teams,
  selectedId,
}: {
  teams: TeamListItem[];
  selectedId: string;
}) {
  if (teams.length < 2) return null;

  return (
    <nav aria-label="Team" className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-text-secondary text-caption mr-1">Policy for</span>
      {teams.map((team) => {
        const active = team.id === selectedId;
        return (
          <Link
            key={team.id}
            href={`/admin/settings?teamId=${team.id}`}
            aria-current={active ? 'page' : undefined}
            className={`text-caption rounded-full border px-3 py-1.5 font-semibold transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-text font-medium'
                : 'border-separator text-text-secondary hover:border-text-secondary hover:text-text'
            }`}
          >
            {team.name}
            <span className="text-text-secondary tt-numeric ml-2 text-caption">
              {team.memberCount}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

import type { CatalogState } from './actions';

/** What an import created, shared (with the client's home team) and skipped, or its error. */
export function ImportResult({ state }: { state: CatalogState }) {
  if (!state.ok) {
    return state.message ? (
      <p className="text-destructive text-body" role="status">
        {state.message}
      </p>
    ) : null;
  }
  const created = state.created ?? [];
  const shared = state.shared ?? [];
  const skipped = state.skipped ?? [];
  if (created.length === 0 && shared.length === 0 && skipped.length === 0) return null;
  return (
    <div
      className={`text-caption grid gap-3 ${shared.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
      role="status"
    >
      <div>
        <p className="text-text-secondary mb-1">Created ({created.length})</p>
        <ul className="flex flex-col gap-0.5">
          {created.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
      {shared.length > 0 ? (
        <div>
          <p className="text-text-secondary mb-1">Shared ({shared.length})</p>
          <ul className="flex flex-col gap-0.5">
            {shared.map((s) => (
              <li key={s.name}>
                {s.name} <span className="text-text-secondary">— shared with {s.homeTeam}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="text-text-secondary mb-1">Skipped ({skipped.length})</p>
        <ul className="flex flex-col gap-0.5">
          {skipped.map((s, i) => (
            <li key={`${i}-${s.name}`}>
              {s.name} <span className="text-text-secondary">— {s.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

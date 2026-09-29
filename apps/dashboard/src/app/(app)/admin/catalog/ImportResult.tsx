import type { CatalogState } from './actions';

/** What an import created and skipped (with reasons), or its error. */
export function ImportResult({ state }: { state: CatalogState }) {
  if (!state.ok) {
    return state.message ? (
      <p className="text-destructive text-body" role="status">
        {state.message}
      </p>
    ) : null;
  }
  const created = state.created ?? [];
  const skipped = state.skipped ?? [];
  if (created.length === 0 && skipped.length === 0) return null;
  return (
    <div className="text-caption grid gap-3 sm:grid-cols-2" role="status">
      <div>
        <p className="text-text-secondary mb-1">Created ({created.length})</p>
        <ul className="flex flex-col gap-0.5">
          {created.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
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

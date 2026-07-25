'use client';

import { useState, useTransition } from 'react';
import { tileMode, type ScreenshotView } from './screenshot-view';
import type { RedactResult } from './actions';

type RedactFn = (id: string, reason: string) => Promise<RedactResult>;

export function ScreenshotsPanel({
  shots,
  onRedact,
}: {
  shots: ScreenshotView[];
  onRedact: RedactFn;
}) {
  if (shots.length === 0) {
    return <p className="text-text-secondary text-body">No screenshots recorded today.</p>;
  }
  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
      {shots.map((s) => (
        <li key={s.id}>
          <Tile shot={s} onRedact={onRedact} />
        </li>
      ))}
    </ul>
  );
}

function Tile({ shot, onRedact }: { shot: ScreenshotView; onRedact: RedactFn }) {
  const mode = tileMode(shot);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (mode === 'redacted') {
    return (
      <figure className="m-0 flex flex-col gap-1.5">
        <div className="bg-surface border-separator flex aspect-[16/10] w-full items-center justify-center rounded-lg border">
          <span className="bg-surface-raised text-text-secondary text-caption rounded px-1.5 py-0.5 font-medium">
            Redacted
          </span>
        </div>
        <figcaption className="text-caption text-text-secondary flex flex-col gap-0.5">
          {shot.redactedReason ? <span>{shot.redactedReason}</span> : null}
          <span className="tt-numeric">{shot.timestamp.slice(11, 16)}</span>
        </figcaption>
      </figure>
    );
  }

  if (mode === 'pending') {
    return (
      <figure className="m-0 flex flex-col gap-1.5">
        <div className="bg-surface border-separator flex aspect-[16/10] w-full items-center justify-center rounded-lg border">
          <span className="text-caption text-text-secondary">{shot.status}</span>
        </div>
        <figcaption className="tt-numeric text-caption text-text-secondary">
          {shot.timestamp.slice(11, 16)}
        </figcaption>
      </figure>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await onRedact(shot.id, reason);
      if (res.ok) {
        setOpen(false);
        setReason('');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="border-separator relative aspect-[16/10] w-full overflow-hidden rounded-lg border">
        {/* Presigned MinIO URL, not a static asset — next/image is not applicable here. */}
        <img
          src={shot.url}
          alt={`Screenshot ${shot.timestamp}`}
          className="h-full w-full object-cover"
        />
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-surface-raised border-separator text-text hover:bg-surface text-caption absolute right-1.5 bottom-1.5 rounded-full border px-2.5 py-0.5 transition-colors"
          >
            Redact
          </button>
        ) : null}
      </div>
      <figcaption className="tt-numeric text-caption text-text-secondary">
        {shot.timestamp.slice(11, 16)}
      </figcaption>
      {open ? (
        <div className="flex flex-col gap-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason…"
            aria-label="Redaction reason"
            className="bg-surface-raised border-separator text-text focus:border-accent text-caption rounded border px-1.5 py-1 outline-none"
          />
          <span className="text-category-unproductive text-caption">
            ⚠ Permanently deletes this image.
          </span>
          {error ? <span className="text-destructive text-caption">{error}</span> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length === 0}
              onClick={submit}
              className="bg-accent hover:bg-accent-hover text-caption rounded px-2 py-1 text-white transition-colors disabled:opacity-50"
            >
              {pending ? 'Redacting…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setReason('');
                setError(null);
              }}
              className="border-separator text-text hover:bg-surface text-caption rounded border px-2 py-1 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </figure>
  );
}

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
    <ul className="grid grid-cols-3 gap-2">
      {shots.map((s) => (
        <li key={s.id} className="border-separator text-caption rounded-md border p-2">
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
      <div className="flex flex-col gap-1">
        <span className="bg-surface text-text-secondary w-fit rounded px-1.5 py-0.5 font-medium">
          Redacted
        </span>
        {shot.redactedReason ? (
          <span className="text-text-secondary">{shot.redactedReason}</span>
        ) : null}
        <span className="tt-numeric text-text-secondary">{shot.timestamp.slice(11, 16)}</span>
      </div>
    );
  }

  if (mode === 'pending') {
    return (
      <span className="text-text-secondary">
        <span className="tt-numeric">{shot.timestamp.slice(11, 16)}</span> · {shot.status}
      </span>
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
    <div className="flex flex-col gap-1">
      {/* Presigned MinIO URL, not a static asset — next/image is not applicable here. */}
      <img src={shot.url} alt={`Screenshot ${shot.timestamp}`} className="max-w-full rounded" />
      {open ? (
        <div className="flex flex-col gap-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason…"
            aria-label="Redaction reason"
            className="bg-surface-raised border-separator text-text focus:border-accent rounded border px-1.5 py-1 outline-none"
          />
          <span className="text-category-unproductive">⚠ Permanently deletes this image.</span>
          {error ? <span className="text-destructive">{error}</span> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length === 0}
              onClick={submit}
              className="bg-accent hover:bg-accent-hover rounded px-2 py-1 text-white transition-colors disabled:opacity-50"
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
              className="border-separator text-text hover:bg-surface rounded border px-2 py-1 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-separator text-text hover:bg-surface w-fit rounded border px-2 py-1 transition-colors"
        >
          Redact
        </button>
      )}
    </div>
  );
}

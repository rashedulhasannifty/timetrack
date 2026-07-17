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
    return <p className="text-sm text-neutral-500">No screenshots recorded today.</p>;
  }
  return (
    <ul className="grid grid-cols-3 gap-2">
      {shots.map((s) => (
        <li key={s.id} className="rounded-md border border-neutral-200 p-2 text-xs">
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
        <span className="w-fit rounded bg-neutral-200 px-1.5 py-0.5 font-medium text-neutral-700">
          Redacted
        </span>
        {shot.redactedReason ? (
          <span className="text-neutral-600">{shot.redactedReason}</span>
        ) : null}
        <span className="text-neutral-400">{shot.timestamp.slice(11, 16)}</span>
      </div>
    );
  }

  if (mode === 'pending') {
    return (
      <span className="text-neutral-500">
        {shot.timestamp.slice(11, 16)} · {shot.status}
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
            className="rounded border border-neutral-300 px-1.5 py-1"
          />
          <span className="text-amber-600">⚠ Permanently deletes this image.</span>
          {error ? <span className="text-red-600">{error}</span> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length === 0}
              onClick={submit}
              className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-50"
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
              className="rounded border border-neutral-300 px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit rounded border border-neutral-300 px-2 py-1 text-neutral-700"
        >
          Redact
        </button>
      )}
    </div>
  );
}

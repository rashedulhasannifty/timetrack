'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  groupLabel,
  groupShots,
  isOpenable,
  openableShots,
  shotDescription,
  shotTime,
  stepIndex,
  tileCaption,
  tileMode,
  type ScreenshotView,
  type ShotGroup,
} from './screenshot-view';
import type { RedactResult } from './actions';
import { buttonClasses } from '../../../components/ui/Button';

type RedactFn = (id: string, reason: string) => Promise<RedactResult>;

export function ScreenshotsPanel({
  shots,
  onRedact,
}: {
  shots: ScreenshotView[];
  /** Omit for a read-only surface (e.g. the manager per-person view) — redaction is self-only. */
  onRedact?: RedactFn;
}) {
  // Only shots with a full-res object can be opened, and the lightbox pages through exactly
  // those — so its indices must come from the same filtered list the tiles look themselves up in.
  // It pages across the whole day, not within a group: stopping at a group boundary would be a
  // surprise, and the displays of one tick sit next to each other in that order anyway.
  const openable = openableShots(shots);
  // Each capture tick is one group — on a multi-monitor desk that is every attached display,
  // shown together instead of scattered through the grid as unrelated tiles.
  const groups = groupShots(shots);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (shots.length === 0) {
    return <p className="text-text-secondary text-body">No screenshots recorded today.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-5">
        {groups.map((group) => (
          <li key={group.key}>
            <GroupHeader group={group} />
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
              {group.shots.map((s) => (
                <li key={s.id}>
                  <Tile
                    shot={s}
                    caption={tileCaption(s, group)}
                    onRedact={onRedact}
                    onOpen={
                      isOpenable(s)
                        ? () => setOpenIndex(openable.findIndex((o) => o.id === s.id))
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {openIndex !== null && openable[openIndex] ? (
        <Lightbox
          shots={openable}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </>
  );
}

/**
 * The capture time, plus how many displays that tick covered. A single-display capture gets no
 * badge — most desks are one screen and a "1 display" chip on every row would be noise.
 */
function GroupHeader({ group }: { group: ShotGroup }) {
  const label = groupLabel(group);
  const incomplete = label !== null && group.shots.length < (group.attempted ?? 0);
  return (
    <div className="mb-1.5 flex items-baseline gap-2">
      <span className="tt-numeric text-caption text-text-secondary">
        {shotTime(group.timestamp)}
      </span>
      {label ? (
        <span
          className={`text-caption rounded px-1.5 py-0.5 font-medium ${
            incomplete
              ? 'bg-surface-raised text-category-unproductive'
              : 'bg-surface-raised text-text-secondary'
          }`}
          // Said out loud rather than left to the colour: a display that failed to capture is a
          // gap in the record, and a gap that looks complete is worse than a visible one.
          title={incomplete ? 'A display failed to capture in this interval.' : undefined}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Full-size viewer. Esc or a click on the backdrop closes it; ← / → page through the day's
 * captures without wrapping. Rendered inline rather than in a portal — the panel is already the
 * last thing on the page and a fixed overlay needs no portal to escape stacking here.
 */
function Lightbox({
  shots,
  index,
  onIndexChange,
  onClose,
}: {
  shots: ScreenshotView[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const shot = shots[index]!;

  const step = useCallback(
    (delta: number) => {
      const next = stepIndex(shots.length, index, delta);
      if (next !== null) onIndexChange(next);
    },
    [shots.length, index, onIndexChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot at ${shotDescription(shot)}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6"
    >
      <div className="flex w-full max-w-5xl items-center justify-between gap-3">
        <span className="tt-numeric text-body text-white/80">
          {shotDescription(shot)} · {index + 1} of {shots.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={buttonClasses('secondary', 'sm')}
        >
          Close
        </button>
      </div>
      {/* Presigned MinIO URL, not a static asset — next/image is not applicable here. */}
      <img
        src={shot.fullUrl}
        alt={`Screenshot at ${shotDescription(shot)}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] max-w-5xl rounded-lg object-contain shadow-e1"
      />
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index === 0}
          aria-label="Previous screenshot"
          className={`${buttonClasses('secondary', 'sm')} disabled:opacity-40`}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index === shots.length - 1}
          aria-label="Next screenshot"
          className={`${buttonClasses('secondary', 'sm')} disabled:opacity-40`}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function Tile({
  shot,
  caption,
  onRedact,
  onOpen,
}: {
  shot: ScreenshotView;
  /** "Display 2" inside a multi-display group, else the capture time. */
  caption: string;
  onRedact?: RedactFn | undefined;
  /** Absent when there is no full-res object to open (redacted, pending, or no fullUrl). */
  onOpen?: (() => void) | undefined;
}) {
  const mode = tileMode(shot);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (mode === 'redacted') {
    return (
      <figure className="m-0 flex flex-col gap-1.5">
        <div className="bg-surface border-separator flex aspect-[16/10] w-full items-center justify-center rounded-[10px] border">
          <span className="bg-surface-raised text-text-secondary text-caption rounded px-1.5 py-0.5 font-medium">
            Redacted
          </span>
        </div>
        <figcaption className="text-caption text-text-secondary flex flex-col gap-0.5">
          {shot.redactedReason ? <span>{shot.redactedReason}</span> : null}
          <span className="tt-numeric">{caption}</span>
        </figcaption>
      </figure>
    );
  }

  if (mode === 'pending') {
    return (
      <figure className="m-0 flex flex-col gap-1.5">
        <div className="bg-surface border-separator flex aspect-[16/10] w-full items-center justify-center rounded-[10px] border">
          <span className="text-caption text-text-secondary">{shot.status}</span>
        </div>
        <figcaption className="tt-numeric text-caption text-text-secondary">{caption}</figcaption>
      </figure>
    );
  }

  function submit() {
    if (!onRedact) return;
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
      <div className="border-separator relative aspect-[16/10] w-full overflow-hidden rounded-[10px] border">
        {/* Presigned MinIO URL, not a static asset — next/image is not applicable here. */}
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`View screenshot at ${shotDescription(shot)} full size`}
            className="focus:outline-accent block h-full w-full cursor-zoom-in"
          >
            <img
              src={shot.url}
              alt={`Screenshot ${shot.timestamp}`}
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <img
            src={shot.url}
            alt={`Screenshot ${shot.timestamp}`}
            className="h-full w-full object-cover"
          />
        )}
        {!open && onRedact ? (
          <button
            type="button"
            // Sits on top of the open-full-size button; without this the click would open the
            // lightbox as well as the redact form.
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={`${buttonClasses('secondary', 'xs')} absolute right-1.5 bottom-1.5`}
          >
            Redact
          </button>
        ) : null}
      </div>
      <figcaption className="tt-numeric text-caption text-text-secondary">{caption}</figcaption>
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
              className={buttonClasses('primary', 'xs')}
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
              className={buttonClasses('secondary', 'xs')}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </figure>
  );
}

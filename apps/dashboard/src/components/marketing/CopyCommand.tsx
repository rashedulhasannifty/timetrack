'use client';

import { useState } from 'react';

/**
 * A shell command with a copy button. Client component because the copy is real
 * interaction — the guide asks non-technical testers to paste into Terminal, and
 * retyping an `xattr` path by hand is where they get it wrong.
 *
 * navigator.clipboard needs a secure context; if it is missing or the write is
 * refused we select the text instead so the reader can still copy manually.
 */
export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(command);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1600);
  }

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy';

  return (
    <div className="border-separator bg-surface-raised flex items-stretch overflow-hidden rounded-md border">
      <pre className="flex-1 overflow-x-auto px-4 py-3">
        <code className="font-mono text-[0.8125rem] whitespace-pre">{command}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        className={`border-separator text-caption hover:text-text hover:bg-surface shrink-0 border-l px-4 font-mono tracking-[0.07em] uppercase transition-colors ${
          state === 'copied' ? 'text-good' : 'text-text-secondary'
        }`}
      >
        {label}
      </button>
    </div>
  );
}

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from './Toast';

describe('ToastProvider', () => {
  it('renders its children', () => {
    expect(
      renderToStaticMarkup(
        <ToastProvider>
          <span>app</span>
        </ToastProvider>,
      ),
    ).toContain('app');
  });

  /** Nothing has fired yet, so the region must be empty — but it must still EXIST, because
   *  a live region added to the DOM at the same moment as its first message is not reliably
   *  announced. */
  it('renders an empty live region up front', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <span>app</span>
      </ToastProvider>,
    );
    expect(html).toContain('aria-live="polite"');
  });

  /**
   * Destructive toasts announce through their own `role="alert"` region instead of the polite
   * one (see the comment in Toast.tsx for why), and — same reasoning as the polite region
   * above — it has to be mounted up front too, not inserted the first time a destructive toast
   * fires.
   */
  it('renders an empty alert region up front, for destructive toasts', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <span>app</span>
      </ToastProvider>,
    );
    expect(html).toContain('role="alert"');
  });
});

/**
 * A toast only exists once `push()` fires it through the context, which this DOM-less suite
 * cannot do — `useToast()`'s only caller is a client event handler. So the dismiss button and
 * the pointer-events opt-in it needs are pinned by reading the source, the same way
 * TabPills.spec.tsx pins a CSS selector it cannot reach by rendering.
 */
describe('toast dismiss button', () => {
  const src = readFileSync(join(__dirname, './Toast.tsx'), 'utf8');

  it('labels the dismiss button for assistive tech', () => {
    expect(src).toContain('aria-label="Dismiss notification"');
  });

  it('reuses IconClose rather than a bespoke glyph', () => {
    expect(src).toContain('IconClose');
  });

  /** The toasts container is pointer-events-none so it never blocks clicks on the page behind
   *  it; each toast row has to opt back in or its own dismiss button is unclickable. */
  it('opts each toast row back into pointer events', () => {
    expect(src).toContain('pointer-events-auto');
  });
});

import { describe, it, expect } from 'vitest';
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
});

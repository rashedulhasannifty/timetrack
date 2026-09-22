import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Drawer } from './Drawer';

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <Drawer open onClose={() => {}} title="Details" {...over}>
      body
    </Drawer>,
  );

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    expect(
      renderToStaticMarkup(
        <Drawer open={false} onClose={() => {}} title="t">
          body
        </Drawer>,
      ),
    ).toBe('');
  });

  it('renders its title and body when open', () => {
    const html = render();
    expect(html).toContain('Details');
    expect(html).toContain('body');
  });

  /** It is a modal surface: without these the panel is announced as ordinary page content
   *  and a screen-reader user has no idea a layer opened over the page. */
  it('is announced as a labelled dialog', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-label(ledby)?=/);
  });

  it('renders a footer when given', () => {
    expect(render({ footer: <span>foot</span> })).toContain('foot');
  });

  it('renders a close control', () => {
    expect(render()).toMatch(/aria-label="Close/);
  });
});

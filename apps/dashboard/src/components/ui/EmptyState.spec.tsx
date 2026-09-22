import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing here" />)).toContain('Nothing here');
  });

  /** A heading, not a styled span, so screen-reader users can jump straight to it. */
  it('renders the title as a heading', () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing here" />)).toContain('<h2');
  });

  it('renders the body when given', () => {
    const html = renderToStaticMarkup(<EmptyState title="t" body="explain why" />);
    expect(html).toContain('explain why');
  });

  it('omits the body element entirely when not given', () => {
    expect(renderToStaticMarkup(<EmptyState title="t" />)).not.toContain('<p');
  });

  it('renders an action when given', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="t" action={<button type="button">Do it</button>} />,
    );
    expect(html).toContain('Do it');
  });

  /** Decorative: the title carries the meaning, so the glyph must not be announced twice. */
  it('hides a decorative icon from assistive tech', () => {
    const html = renderToStaticMarkup(<EmptyState title="t" icon={<svg />} />);
    expect(html).toContain('aria-hidden="true"');
  });
});

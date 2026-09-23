import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from './Card';

/** No DOM in this vitest environment — pin the emitted classes (see PasswordField.spec.tsx). */
const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<Card {...props}>body</Card>);

describe('Card', () => {
  /** Static depth comes from the elevation token, not a class, so all 15 existing
   *  shadow-e1 call sites picked up the new depth without being touched. */
  it('carries the elevation token by default', () => {
    expect(render()).toContain('shadow-e1');
  });

  it('is flat-hovering unless told it is interactive', () => {
    expect(render()).not.toContain('card-3d-interactive');
  });

  it('adds the hover lift when interactive', () => {
    expect(render({ interactive: true })).toContain('card-3d-interactive');
  });

  it('applies the standard panel padding only when asked', () => {
    expect(render({ padding: 'md' })).toContain('px-[26px]');
    expect(render()).not.toContain('px-[26px]');
  });

  it('keeps caller classes', () => {
    expect(render({ className: 'mt-4' })).toContain('mt-4');
  });
});

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PasswordField } from './PasswordField';

/**
 * Rendered to static markup — the dashboard's vitest runs in a node environment with no DOM,
 * so this pins the emitted attributes rather than simulating clicks. The attributes are where
 * the real hazards live.
 */
const render = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <PasswordField name="password" placeholder="Password" className="cls" {...extra} />,
  );

describe('PasswordField', () => {
  it('is masked by default', () => {
    expect(render()).toContain('type="password"');
  });

  /**
   * The toggle sits inside a <form>, where a button's default type is "submit". Without an
   * explicit type="button" a click meant to reveal the password submits the half-typed form
   * instead — and on the invite page that burns a single-use token.
   */
  it('renders the toggle as type=button so it cannot submit the form', () => {
    const html = render();
    const button = html.slice(html.indexOf('<button'));
    expect(button).toContain('type="button"');
  });

  it('keeps the field uncontrolled so the form still POSTs natively', () => {
    // A `value` attribute would mean React owns the value; the auth pages submit natively.
    const html = render();
    expect(html.slice(0, html.indexOf('<button'))).not.toContain('value=');
  });

  it('labels the toggle for screen readers and starts unpressed', () => {
    const html = render();
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
  });

  // Matched case-insensitively: renderToStaticMarkup emits `minLength`/`autoComplete` in
  // camelCase. HTML attribute names are case-insensitive so the browser is unaffected — but a
  // lowercase-only assertion passes vacuously on the negative test below, which is worse than
  // no test at all.
  it('passes validation attributes through to the input', () => {
    const html = render({ minLength: 8, required: true, autoComplete: 'new-password' });
    expect(html).toMatch(/minlength="8"/i);
    expect(html).toMatch(/required=""/i);
    expect(html).toMatch(/autocomplete="new-password"/i);
  });

  /** Omitted optionals must not leak as empty attributes (exactOptionalPropertyTypes). */
  it('omits validation attributes when not asked for', () => {
    const html = render();
    expect(html).not.toMatch(/minlength/i);
    expect(html).not.toMatch(/required/i);
  });

  it('reserves room so a long password does not run under the button', () => {
    expect(render()).toContain('pr-11');
  });
});

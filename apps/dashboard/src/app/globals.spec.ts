import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** Extract the body of a top-level rule, e.g. block(':root') or block('.dark'). */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

const declared = (body: string) =>
  new Set(Array.from(body.matchAll(/(--tt-[a-z0-9-]+)\s*:/g), (m) => m[1]));

/**
 * Tokens that are the same value in both themes ON PURPOSE. The hero family is a fixed
 * dark-teal ground in both themes, and the two mark arcs are baked into icon.svg /
 * apple-icon.png, which cannot follow a theme (see the comments in globals.css).
 */
const THEME_INVARIANT = new Set([
  '--tt-hero',
  '--tt-hero-2',
  '--tt-hero-text',
  '--tt-hero-dim',
  '--tt-mark-remaining',
  '--tt-mark-elapsed',
]);

describe('globals.css token parity', () => {
  it('gives every themed :root token a .dark counterpart', () => {
    const light = declared(block(':root'));
    const dark = declared(block('.dark'));
    const missing = [...light].filter((t) => !THEME_INVARIANT.has(t) && !dark.has(t));
    expect(missing).toEqual([]);
  });

  it('declares the structural tokens the depth recipes depend on', () => {
    const light = declared(block(':root'));
    for (const token of [
      '--tt-border-strong',
      '--tt-muted-bg',
      '--tt-hover',
      '--tt-glow',
      '--tt-glow-strong',
      '--tt-accent-edge',
      '--tt-destructive-edge',
    ]) {
      expect(light.has(token), `${token} missing from :root`).toBe(true);
    }
  });

  it('declares one nav hue per sidebar destination', () => {
    const light = declared(block(':root'));
    for (const dest of ['overview', 'projects', 'reports', 'approvals', 'admin', 'me', 'install']) {
      expect(light.has(`--tt-nav-${dest}`), `--tt-nav-${dest} missing`).toBe(true);
    }
  });

  it('tightens the radius scale to the clickup-sync steps', () => {
    expect(css).toMatch(/--radius-sm:\s*4px/);
    expect(css).toMatch(/--radius-md:\s*8px/);
    expect(css).toMatch(/--radius-lg:\s*12px/);
  });
});

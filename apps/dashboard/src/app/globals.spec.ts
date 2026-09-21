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
  new Set(
    Array.from(body.matchAll(/(--tt-[a-z0-9-]+)\s*:/g), (m) => m[1]).filter(
      (v): v is string => v !== undefined,
    ),
  );

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

describe('globals.css depth recipes', () => {
  it('defines every recipe class the primitives rely on', () => {
    for (const cls of [
      '.btn-3d',
      '.input-3d',
      '.card-3d-interactive',
      '.row-3d',
      '.seg-track',
      '.seg-tab',
    ]) {
      expect(css.includes(`${cls} {`) || css.includes(`${cls}:`), `${cls} missing`).toBe(true);
    }
  });

  /**
   * The light recipes use warm-ink shadows that vanish on a near-black ground, so each
   * depth class that hardcodes an ink shadow needs a .dark override. Dark deliberately
   * gains depth here — it previously set --tt-elevation-1: none.
   */
  it('overrides the ink-shadow recipes under .dark', () => {
    for (const cls of ['.input-3d', '.row-3d', '.seg-track']) {
      expect(css.includes(`.dark ${cls}`), `${cls} has no .dark override`).toBe(true);
    }
  });

  it('no longer disables elevation in dark', () => {
    expect(block('.dark')).not.toMatch(/--tt-elevation-1:\s*none/);
  });

  /**
   * There is no shared Field primitive — 28 files declare their own inputs — so the recess
   * is applied to the elements in @layer base. Checkboxes, radios, colour swatches and
   * range inputs must stay excluded: an inset shadow on them reads as damage, not depth.
   */
  it('recesses text fields globally while sparing checkboxes, radios, colour and range inputs', () => {
    // Light mode: verify all four exclusions are chained on the input selector
    const exclusionChain =
      "input:not([type='checkbox']):not([type='radio']):not([type='color']):not([type='range'])";
    expect(css).toContain(exclusionChain);

    // Dark mode: verify the dark variant also has all four exclusions
    const darkExclusionChain = `.dark input:not([type='checkbox']):not([type='radio']):not([type='color']):not([type='range'])`;
    expect(css).toContain(darkExclusionChain);

    // Textarea is also recessed
    expect(css).toContain('textarea');

    // The rule applies inset shadows
    const ruleStart = css.indexOf(exclusionChain);
    expect(css.slice(ruleStart, ruleStart + 400)).toContain('inset');
  });
});

describe('globals.css density', () => {
  /**
   * The attribute is set by a client provider that does not exist until Phase 6, and it
   * is absent during SSR and in tests. Tables read var(--pad-y) unconditionally, so the
   * comfortable values MUST be the :root default or every table collapses to zero padding.
   */
  it('defaults to comfortable on :root so tables work with no attribute set', () => {
    const root = block(':root');
    expect(root).toMatch(/--row-h:\s*48px/);
    expect(root).toMatch(/--pad-y:\s*12px/);
  });

  it('defines both density modes', () => {
    expect(css).toMatch(/\[data-density=['"]compact['"]\]/);
    expect(css).toMatch(/\[data-density=['"]comfortable['"]\]/);
  });
});

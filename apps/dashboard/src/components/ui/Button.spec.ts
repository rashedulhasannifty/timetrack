import { describe, it, expect } from 'vitest';
import { buttonClasses } from './Button';

describe('buttonClasses', () => {
  it('composes base + variant + size', () => {
    const cls = buttonClasses('primary', 'sm');
    expect(cls).toContain('bg-accent'); // primary variant
    expect(cls).toContain('text-caption px-[13px] py-[6px]'); // sm size
    expect(cls).toContain('rounded-md'); // base — tightened from rounded-full
  });

  /** The three solid/raised variants are pressable; ghost is flat by design — a
   *  borderless text control with a 3D edge reads as a floating artefact. */
  it('makes the raised variants pressable and leaves ghost flat', () => {
    expect(buttonClasses('primary', 'md')).toContain('btn-3d');
    expect(buttonClasses('secondary', 'md')).toContain('btn-3d');
    expect(buttonClasses('destructive', 'md')).toContain('btn-3d');
    expect(buttonClasses('ghost', 'md')).not.toContain('btn-3d');
  });

  /** .btn-3d reads --b-edge off the element; a variant that forgets it renders
   *  with an invisible edge and silently loses its depth. */
  it('gives every pressable variant its own edge colour', () => {
    for (const v of ['primary', 'secondary', 'destructive'] as const) {
      expect(buttonClasses(v, 'md'), v).toContain('[--b-edge:');
    }
  });

  it('is no longer a pill', () => {
    expect(buttonClasses()).not.toContain('rounded-full');
  });

  it('supports the xs size for compact contexts', () => {
    expect(buttonClasses('secondary', 'xs')).toContain('text-caption px-3 py-[5px]');
  });

  it('renders each variant', () => {
    expect(buttonClasses('primary', 'md')).toContain('bg-accent');
    expect(buttonClasses('secondary', 'md')).toContain('border-separator');
    expect(buttonClasses('destructive', 'md')).toContain('bg-destructive');
    expect(buttonClasses('ghost', 'md')).toContain('hover:bg-hover');
  });

  it('gives every variant a distinct look', () => {
    const all = (['primary', 'secondary', 'destructive', 'ghost'] as const).map((v) =>
      buttonClasses(v, 'md'),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives every size a distinct metric', () => {
    const all = (['xs', 'sm', 'md'] as const).map((s) => buttonClasses('secondary', s));
    expect(new Set(all).size).toBe(all.length);
  });

  it('defaults to secondary + md', () => {
    expect(buttonClasses()).toBe(buttonClasses('secondary', 'md'));
  });
});

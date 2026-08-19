import { describe, it, expect } from 'vitest';
import { buttonClasses } from './Button';

describe('buttonClasses', () => {
  it('composes base + variant + size', () => {
    const cls = buttonClasses('primary', 'sm');
    expect(cls).toContain('bg-accent'); // primary variant
    expect(cls).toContain('text-caption px-[13px] py-[6px]'); // sm size
    expect(cls).toContain('rounded-full'); // base
  });

  it('supports the xs size for compact contexts', () => {
    expect(buttonClasses('secondary', 'xs')).toContain('text-caption px-3 py-[5px]');
  });

  it('renders each variant', () => {
    expect(buttonClasses('primary', 'md')).toContain('bg-accent');
    expect(buttonClasses('secondary', 'md')).toContain('border-separator');
    expect(buttonClasses('destructive', 'md')).toContain('bg-destructive');
    expect(buttonClasses('ghost', 'md')).toContain('hover:bg-surface');
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

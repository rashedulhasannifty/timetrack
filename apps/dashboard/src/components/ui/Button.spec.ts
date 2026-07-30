import { describe, it, expect } from 'vitest';
import { buttonClasses } from './Button';

describe('buttonClasses', () => {
  it('composes base + variant + size', () => {
    const cls = buttonClasses('primary', 'sm');
    expect(cls).toContain('bg-accent'); // primary variant
    expect(cls).toContain('text-label px-3 py-1.5'); // sm size
    expect(cls).toContain('rounded-md'); // base
  });

  it('supports the xs size for compact contexts', () => {
    expect(buttonClasses('secondary', 'xs')).toContain('text-caption px-2.5 py-1');
  });

  it('renders each variant', () => {
    expect(buttonClasses('primary', 'md')).toContain('bg-accent');
    expect(buttonClasses('secondary', 'md')).toContain('border-separator');
    expect(buttonClasses('destructive', 'md')).toContain('bg-destructive');
  });

  it('defaults to secondary + md', () => {
    expect(buttonClasses()).toBe(buttonClasses('secondary', 'md'));
  });
});

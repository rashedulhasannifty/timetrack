import { describe, it, expect } from 'vitest';
import { resolveIdleToastMessage } from './resolve-idle-toast';

describe('resolveIdleToastMessage', () => {
  it('reports a keep', () => {
    expect(resolveIdleToastMessage({ ok: true, resolvedAction: 'KEPT' })).toBe('Idle time kept');
  });

  it('reports a discard', () => {
    expect(resolveIdleToastMessage({ ok: true, resolvedAction: 'DISCARDED' })).toBe(
      'Idle time discarded',
    );
  });
});

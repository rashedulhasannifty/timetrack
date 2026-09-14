import { describe, it, expect } from 'vitest';
import { splitConfirmText } from './ConfirmDialog';

describe('splitConfirmText', () => {
  it('uses the first line as the title and the rest, trimmed, as the body', () => {
    expect(splitConfirmText('Move X to BPO?\n\nFirst detail.\nSecond detail.\n')).toEqual({
      title: 'Move X to BPO?',
      message: 'First detail.\nSecond detail.',
    });
  });

  it('yields an empty body for a single-line question', () => {
    expect(splitConfirmText('Are you sure?')).toEqual({ title: 'Are you sure?', message: '' });
  });
});

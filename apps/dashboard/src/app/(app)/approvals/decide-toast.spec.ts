import { describe, it, expect } from 'vitest';
import { decideToastMessage } from './decide-toast';

describe('decideToastMessage', () => {
  it('reports an approval', () => {
    expect(decideToastMessage({ ok: true, status: 'APPROVED' })).toBe('Timesheet approved');
  });

  it('reports a flag', () => {
    expect(decideToastMessage({ ok: true, status: 'FLAGGED' })).toBe('Timesheet flagged');
  });
});

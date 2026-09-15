import { describe, it, expect, vi } from 'vitest';

// The component module imports the server action; this spec only needs the pure wording helper.
vi.mock('../../app/(app)/projects/actions', () => ({ moveProjectAction: vi.fn() }));

import { describeProjectMove } from './ProjectTeamMove';

describe('describeProjectMove', () => {
  it('names the project and both teams, and says tracked time is unaffected', () => {
    const text = describeProjectMove('Payroll', 'Engineering', { name: 'BPO' });
    expect(text.split('\n')[0]).toBe('Move “Payroll” from Engineering to BPO?');
    expect(text).toContain('BPO’s managers will administer it');
    expect(text).toContain('Engineering’s people will no longer be able to pick it');
    expect(text).toContain('Time already tracked is not affected');
  });
});

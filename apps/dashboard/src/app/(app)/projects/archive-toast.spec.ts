import { describe, it, expect } from 'vitest';
import { archiveToastMessage } from './archive-toast';

describe('archiveToastMessage', () => {
  it('reports a project archive', () => {
    expect(archiveToastMessage('Project', { ok: true, archived: true })).toBe('Project archived');
  });

  it('reports a project restore', () => {
    expect(archiveToastMessage('Project', { ok: true, archived: false })).toBe('Project restored');
  });

  it('reports a task archive', () => {
    expect(archiveToastMessage('Task', { ok: true, archived: true })).toBe('Task archived');
  });

  it('reports a task restore', () => {
    expect(archiveToastMessage('Task', { ok: true, archived: false })).toBe('Task restored');
  });
});

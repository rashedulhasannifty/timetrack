import { describe, it, expect } from 'vitest';
import { describeShareRemoval, removedTeamIds } from './project-share-view';

describe('removedTeamIds', () => {
  it('returns only linked teams missing from the submitted set', () => {
    expect(removedTeamIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });
  it('is empty when teams are only added or unchanged', () => {
    expect(removedTeamIds(['a'], ['a', 'b'])).toEqual([]);
    expect(removedTeamIds(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('describeShareRemoval', () => {
  it('names the teams and says work types are archived but time is kept', () => {
    const text = describeShareRemoval(['Design', 'Dev']);
    expect(text).toContain('Design, Dev');
    expect(text).toContain('archived');
    expect(text).toContain('Time already tracked is kept');
  });
});

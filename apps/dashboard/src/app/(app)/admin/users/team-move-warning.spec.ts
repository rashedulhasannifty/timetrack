import { describe, it, expect } from 'vitest';
import { describeMove } from './TeamSelect';

const team = (name: string, projectCount: number) => ({ name, projectCount });

/**
 * The wording IS the feature. A confirm() that only says "are you sure?" is the same trap with
 * an extra click — what was missing is the consequence nobody could see: the projects do not
 * follow the person, so their tracker goes empty.
 */
describe('describeMove', () => {
  it('names both teams and the person', () => {
    const text = describeMove('Ada', team('Engineering', 6), team('Support', 2));
    expect(text).toContain('Move Ada from Engineering to Support?');
  });

  it('says the projects being left behind stop being trackable', () => {
    const text = describeMove('Ada', team('Engineering', 6), team('Support', 2));
    expect(text).toContain('Engineering’s 6 projects stay with Engineering');
    expect(text).toContain('no longer be able to track against them');
    expect(text).toContain('Support has 2 projects to pick from');
  });

  it('warns plainly when the destination has nothing to track against', () => {
    // The exact case that emptied a real client: a freshly created team with no projects.
    const text = describeMove('Ada', team('Engineering', 6), team('Support', 0));
    expect(text).toContain('Support has no projects yet');
    expect(text).toContain('nothing to pick until one is created there');
  });

  it('does not invent a loss when the old team had no projects', () => {
    const text = describeMove('Ada', team('Engineering', 0), team('Support', 3));
    expect(text).toContain('Engineering has no projects.');
    expect(text).not.toContain('stay with Engineering');
  });

  it('uses singular wording for one project', () => {
    const text = describeMove('Ada', team('Engineering', 1), team('Support', 1));
    expect(text).toContain('1 project stay');
    expect(text).toContain('track against it');
    expect(text).toContain('Support has 1 project to pick from');
  });

  it('says time already tracked is safe, because that is the other thing people fear', () => {
    expect(describeMove('Ada', team('A', 1), team('B', 1))).toContain(
      'Time already tracked is not affected',
    );
  });
});

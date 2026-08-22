import { describe, it, expect } from 'vitest';
import {
  termIssue,
  parseTerms,
  flaggedTerms,
  availableSuggestions,
  appRuleToken,
  appendTerm,
} from './classification-hints';

describe('termIssue — sites', () => {
  it('accepts a plain host, a subdomain, and a valid wildcard', () => {
    expect(termIssue('github.com', 'site')).toBeNull();
    expect(termIssue('docs.google.com', 'site')).toBeNull();
    expect(termIssue('api.*', 'site')).toBeNull();
    expect(termIssue('localhost', 'site')).toBeNull();
  });

  it('flags scheme, path, spaces, and www.', () => {
    expect(termIssue('https://github.com', 'site')).toMatch(/http/i);
    expect(termIssue('github.com/timetrack', 'site')).toMatch(/path/i);
    expect(termIssue('git hub.com', 'site')).toMatch(/space/i);
    expect(termIssue('www.youtube.com', 'site')).toMatch(/www/i);
  });

  it('flags malformed wildcards but not the valid trailing form', () => {
    expect(termIssue('*.foo.com', 'site')).toMatch(/trailing/i);
    expect(termIssue('ap*i.com', 'site')).toMatch(/trailing/i);
    expect(termIssue('*', 'site')).toMatch(/label/i);
    expect(termIssue('.*', 'site')).toMatch(/label/i);
    expect(termIssue('api.*', 'site')).toBeNull();
  });

  it('ignores blank terms', () => {
    expect(termIssue('   ', 'site')).toBeNull();
  });
});

describe('termIssue — apps', () => {
  it('accepts real macOS app names', () => {
    expect(termIssue('Code', 'app')).toBeNull();
    expect(termIssue('Microsoft Teams', 'app')).toBeNull();
    expect(termIssue('IntelliJ IDEA', 'app')).toBeNull();
  });

  it('nudges when an app entry looks like a site host', () => {
    expect(termIssue('github.com', 'app')).toMatch(/site/i);
  });

  it('flags paths, urls, and wildcards in the app list', () => {
    expect(termIssue('https://slack.com', 'app')).toMatch(/http/i);
    expect(termIssue('some/path', 'app')).toMatch(/path|url/i);
    expect(termIssue('api.*', 'app')).toMatch(/wildcard|exact/i);
  });
});

describe('parseTerms / flaggedTerms', () => {
  it('splits on newlines and commas, trimming and dropping blanks', () => {
    expect(parseTerms('github.com, gitlab.com\n\n  slack.com ')).toEqual([
      'github.com',
      'gitlab.com',
      'slack.com',
    ]);
  });

  it('returns only the problematic terms', () => {
    const flagged = flaggedTerms('github.com\nwww.youtube.com\napi.*', 'site');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.term).toBe('www.youtube.com');
    expect(flagged[0]?.issue).toMatch(/www/i);
  });
});

describe('availableSuggestions', () => {
  const apps = [
    { name: 'Code', bundleId: 'com.microsoft.VSCode' },
    { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' },
    { name: 'Figma', bundleId: null },
  ];

  it('drops apps already present by name OR bundleId, preserving ranked order', () => {
    // "code" matches Code by name; the Slack bundleId matches Slack → only Figma remains.
    expect(availableSuggestions(apps, 'code\ncom.tinyspeck.slackmacgap')).toEqual([
      { name: 'Figma', bundleId: null },
    ]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `App${i}`, bundleId: null }));
    expect(availableSuggestions(many, '', 5)).toHaveLength(5);
  });

  it('excludes apps classified in a sibling list (own box empty)', () => {
    // Unproductive box is empty, but Code is already in the Productive list → not suggested.
    expect(availableSuggestions(apps, ['', 'Code'])).toEqual([
      { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' },
      { name: 'Figma', bundleId: null },
    ]);
  });

  it('matches a sibling entry by bundleId too', () => {
    // Slack sits in the sibling list by its bundleId → excluded even though the name differs.
    expect(availableSuggestions(apps, ['Figma', 'com.tinyspeck.slackmacgap'])).toEqual([
      { name: 'Code', bundleId: 'com.microsoft.VSCode' },
    ]);
  });
});

describe('appRuleToken', () => {
  it('prefers the bundleId, falls back to the name', () => {
    expect(appRuleToken({ name: 'Code', bundleId: 'com.microsoft.VSCode' })).toBe(
      'com.microsoft.VSCode',
    );
    expect(appRuleToken({ name: 'Terminal', bundleId: null })).toBe('Terminal');
  });
});

describe('appendTerm', () => {
  it('appends on a new line, with no leading blank line for an empty box', () => {
    expect(appendTerm('', 'Code')).toBe('Code');
    expect(appendTerm('Code', 'Slack')).toBe('Code\nSlack');
    expect(appendTerm('Code\n', 'Slack')).toBe('Code\nSlack');
  });
});

describe('app terms that are bundle ids, not site hosts', () => {
  /**
   * REGRESSION. An app rule matches the display name OR the bundle id (Categorizer.swift), and
   * picking an app from the suggestions deliberately inserts the bundle id because it survives a
   * rename. The hint flagged every one of them as a website: clicking ClickUp inserted
   * `com.clickup.desktop-app` and was immediately told it looked like a site host.
   *
   * These are the exact tokens an admin hit in the wild.
   */
  it.each([
    'com.clickup.desktop-app',
    'us.zoom.xos',
    'com.apple.TextEdit',
    'com.apple.loginwindow',
    'com.apple.systempreferences',
    'com.apple.accessibility.universalAccessAuthWarn',
    'com.timedoctor.desktop',
    'com.termius-dmg.mac',
    'com.niftyitsolution.niftytimer.dev',
  ])('accepts %s as an app rule', (term) => {
    expect(termIssue(term, 'app')).toBeNull();
  });

  /** The warning still has to work — these really do belong in the Sites list. */
  it.each(['slack.com', 'youtube.com', 'gitlab.com', 'calendar.google.com'])(
    'still flags %s as a site host',
    (term) => {
      expect(termIssue(term, 'app')).toMatch(/site host/);
    },
  );

  /**
   * A two-label host whose TLD is a country code is the case that makes "leading label is a TLD"
   * insufficient on its own: `zoom.us` is a website, `us.zoom.xos` is Zoom's bundle id.
   */
  it('tells a country-code host apart from a bundle id that leads with one', () => {
    expect(termIssue('zoom.us', 'app')).toMatch(/site host/);
    expect(termIssue('us.zoom.xos', 'app')).toBeNull();
  });

  /** Plain app names are unaffected. */
  it.each(['Code', 'Visual Studio Code', 'Docker Desktop', 'Xcode'])('leaves %s alone', (term) => {
    expect(termIssue(term, 'app')).toBeNull();
  });
});

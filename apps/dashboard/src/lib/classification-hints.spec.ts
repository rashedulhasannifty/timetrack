import { describe, it, expect } from 'vitest';
import {
  termIssue,
  parseTerms,
  flaggedTerms,
  availableSuggestions,
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
  it('drops already-listed apps (case-insensitive) and preserves ranked order', () => {
    const suggestions = ['Code', 'Slack', 'Figma'];
    expect(availableSuggestions(suggestions, 'code\nzed')).toEqual(['Slack', 'Figma']);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 30 }, (_, i) => `App${i}`);
    expect(availableSuggestions(many, '', 5)).toHaveLength(5);
  });
});

describe('appendTerm', () => {
  it('appends on a new line, with no leading blank line for an empty box', () => {
    expect(appendTerm('', 'Code')).toBe('Code');
    expect(appendTerm('Code', 'Slack')).toBe('Code\nSlack');
    expect(appendTerm('Code\n', 'Slack')).toBe('Code\nSlack');
  });
});

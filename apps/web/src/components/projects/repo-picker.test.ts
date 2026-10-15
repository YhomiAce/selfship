import { describe, expect, it } from 'vitest';
import { timeAgo } from './repo-picker';

describe('timeAgo', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  it.each([
    [null, null],
    ['not a date', null],
    ['2026-10-15T11:59:30Z', 'just now'],
    ['2026-10-15T11:30:00Z', '30 minutes ago'],
    ['2026-10-15T11:00:00Z', '1 hour ago'],
    ['2026-10-14T12:00:00Z', 'yesterday'],
    ['2026-10-05T12:00:00Z', '10 days ago'],
  ])('%p → %p', (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});

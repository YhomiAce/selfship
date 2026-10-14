import { describe, expect, it } from 'vitest';
import { initials } from './user-menu';

describe('initials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['ada', 'A'],
    ['  Grace   Brewster Hopper ', 'GH'],
    ['', ''],
    ['   ', ''],
  ])('%p → %p', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

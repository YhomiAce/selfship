import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
  it('allows in-app paths', () => {
    expect(safeRedirect('/dashboard/servers')).toBe('/dashboard/servers');
  });

  it.each([
    null,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('falls back for %p', (next) => {
    expect(safeRedirect(next)).toBe('/dashboard');
  });
});

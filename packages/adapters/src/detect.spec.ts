import { detectAdapter } from './detect';
import { memoryRepo } from './testing';
import type { Adapter, AdapterName } from './types';

/** Fake adapter that matches when the given file exists. */
function adapterMatching(name: AdapterName, file: string): Adapter {
  return {
    name,
    detect: (repo) =>
      Promise.resolve(repo.files.has(file) ? { adapter: name, reason: `Found ${file}` } : null),
    defaults: () => Promise.resolve({ port: 3000 }),
    dockerfile: () => '',
  };
}

describe('detectAdapter', () => {
  const adapters = [
    adapterMatching('dockerfile', 'Dockerfile'),
    adapterMatching('static', 'index.html'),
  ];

  it('returns the first matching adapter in priority order', async () => {
    const match = await detectAdapter(adapters, memoryRepo({ Dockerfile: '', 'index.html': '' }));
    expect(match?.adapter.name).toBe('dockerfile');
  });

  it('falls through to later adapters', async () => {
    const match = await detectAdapter(adapters, memoryRepo({ 'index.html': '<h1>hi</h1>' }));
    expect(match?.result).toEqual({ adapter: 'static', reason: 'Found index.html' });
  });

  it('returns null when nothing matches', async () => {
    expect(await detectAdapter(adapters, memoryRepo({ 'README.md': '' }))).toBeNull();
  });
});

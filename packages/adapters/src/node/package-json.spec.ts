import { memoryRepo } from '../testing';
import { detectNodeVersion, parseNodeMajor, readPackageJson } from './package-json';

describe('parseNodeMajor', () => {
  it.each([
    ['v20.11.0', 20],
    ['>=18', 18],
    ['^22.1', 22],
    ['20.x', 20],
    ['lts/iron', null],
  ])('%p → %p', (input, expected) => {
    expect(parseNodeMajor(input)).toBe(expected);
  });
});

describe('detectNodeVersion', () => {
  const versionFor = async (files: Record<string, string>): Promise<number> => {
    const repo = memoryRepo({ 'package.json': '{}', ...files });
    const pkg = await readPackageJson(repo);
    if (!pkg) throw new Error('no package.json');
    return detectNodeVersion(repo, pkg);
  };

  it('prefers .nvmrc over engines', async () => {
    expect(await versionFor({ '.nvmrc': '24', 'package.json': '{"engines":{"node":"20"}}' })).toBe(
      24,
    );
  });

  it('maps ">=16" to the oldest supported version that satisfies it', async () => {
    expect(await versionFor({ 'package.json': '{"engines":{"node":">=16"}}' })).toBe(18);
  });

  it('falls back to the default for unsupported exact versions', async () => {
    expect(await versionFor({ '.nvmrc': '14' })).toBe(22);
  });
});

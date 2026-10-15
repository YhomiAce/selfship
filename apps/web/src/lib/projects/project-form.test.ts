import { describe, expect, it } from 'vitest';
import { cleanSettings, ProjectFormSchema, suggestProjectName } from './project-form';

describe('suggestProjectName', () => {
  it.each([
    ['My_Cool.Site', 'my-cool-site'],
    ['--weird--', 'weird'],
    ['___', 'my-app'],
    ['a'.repeat(60), 'a'.repeat(40)],
  ])('%p → %p', (input, expected) => {
    expect(suggestProjectName(input)).toBe(expected);
    expect(ProjectFormSchema.shape.name.safeParse(expected).success).toBe(true);
  });
});

describe('cleanSettings', () => {
  it('clears fields the project type does not use', () => {
    expect(
      cleanSettings({
        adapter: 'static',
        installCommand: 'npm ci',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        outputDirectory: 'public',
        port: 80,
        nodeVersion: 22,
      }),
    ).toEqual({
      adapter: 'static',
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      outputDirectory: 'public',
      port: 80,
      nodeVersion: null,
    });
  });
});

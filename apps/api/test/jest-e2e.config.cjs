/** Integration tests: need Postgres + Redis (docker-compose.dev.yml or CI services). */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  setupFiles: ['<rootDir>/setup-env.ts'],
};

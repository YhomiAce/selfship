import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load the monorepo root .env so DATABASE_URL is shared by all apps.
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` runs on every build and never connects to a database,
    // so it must work without DATABASE_URL (CI build/lint steps have no .env).
    // Commands that do connect (migrate, studio) hit this unresolvable `.invalid`
    // host and fail with an obvious error instead of touching a real database.
    url: process.env.DATABASE_URL ?? 'postgresql://unset@database-url-not-set.invalid:5432/unset',
  },
});

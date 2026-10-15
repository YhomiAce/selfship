import path from 'node:path';
import { config } from 'dotenv';

// Integration tests read the same root .env as local development.
// Values already set in the environment (e.g. by CI) take precedence.
config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
process.env.NODE_ENV = 'test';
// Keep test output readable: only warnings and errors (set TEST_LOG_LEVEL to debug).
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'warn';

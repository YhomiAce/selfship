import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

/**
 * Integration tests take only infrastructure addresses from the developer's
 * root .env (or CI's environment). Personal settings such as real GitHub App
 * credentials or webhook secrets must never change test behaviour, so they
 * are deliberately not loaded; tests that need them set their own values.
 */
const INFRA_KEYS = ['DATABASE_URL', 'REDIS_URL'] as const;

const envFile = path.resolve(__dirname, '../../../.env');
const fromFile = existsSync(envFile) ? parse(readFileSync(envFile)) : {};
for (const key of INFRA_KEYS) {
  const value = fromFile[key];
  if (process.env[key] === undefined && value) process.env[key] = value;
}

process.env.NODE_ENV = 'test';
// Keep test output readable: only warnings and errors (set TEST_LOG_LEVEL to debug).
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'warn';

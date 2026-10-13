import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed access to validated configuration.
 *
 * Use this instead of `process.env` so every value is validated and typed.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Returns a validated configuration value.
   *
   * @param key - Environment variable name
   * @returns The parsed value with its schema type
   */
  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** Whether the app runs in production mode. */
  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}

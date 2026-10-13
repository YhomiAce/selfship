import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** argon2id parameters (OWASP-recommended baseline, tuned for small servers). */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes and verifies passwords with argon2id. */
@Injectable()
export class PasswordService {
  /** Hash of a random string, verified against when the user doesn't exist. */
  private dummyHash: Promise<string> | null = null;

  /**
   * Hashes a password for storage.
   *
   * @param password - Plain-text password
   * @returns argon2id hash (includes salt and parameters)
   */
  hash(password: string): Promise<string> {
    return argon2.hash(password, HASH_OPTIONS);
  }

  /**
   * Checks a password against a stored hash.
   *
   * When `hash` is null (unknown user or GitHub-only account) a dummy hash is
   * still verified, so response time doesn't reveal whether the account exists.
   *
   * @param hash - Stored hash, or null
   * @param password - Plain-text password to check
   * @returns True only if a real hash matched
   */
  async verify(hash: string | null, password: string): Promise<boolean> {
    if (hash === null) {
      this.dummyHash ??= this.hash('dummy-password-for-timing');
      await argon2.verify(await this.dummyHash, password);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed hash: treat as a failed login rather than a server error.
      return false;
    }
  }

  /**
   * Whether a hash was created with outdated parameters and should be replaced.
   *
   * @param hash - Stored hash
   * @returns True if the hash should be recomputed on next successful login
   */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, HASH_OPTIONS);
  }
}

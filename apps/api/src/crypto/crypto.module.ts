import { Global, Module } from '@nestjs/common';
import { EnvelopeCipher, parseMasterKeys } from '@selfship/crypto';
import { AppConfigService } from '../config/app-config.service';

/**
 * Builds the envelope cipher from config. Fails at startup (not at first use)
 * if the master key is malformed.
 *
 * @param config - Validated configuration
 * @returns The cipher used to encrypt secrets at rest
 */
export function createCipher(config: AppConfigService): EnvelopeCipher {
  const keys = parseMasterKeys(
    config.get('ENCRYPTION_KEY_ID'),
    config.get('ENCRYPTION_KEY'),
    config.get('ENCRYPTION_PREVIOUS_KEYS') ?? '',
  );
  return new EnvelopeCipher(keys.active, keys.previous);
}

/** Provides {@link EnvelopeCipher} for encrypting secrets (SSH keys, later env vars). */
@Global()
@Module({
  providers: [{ provide: EnvelopeCipher, inject: [AppConfigService], useFactory: createCipher }],
  exports: [EnvelopeCipher],
})
export class CryptoModule {}

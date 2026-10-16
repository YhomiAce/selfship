import { Global, Module } from '@nestjs/common';
import { EnvelopeCipher, parseMasterKeys } from '@selfship/crypto';
import { AppConfigService } from '../config/app-config.service';

/** Provides {@link EnvelopeCipher} (same master key as the API) to decrypt stored SSH keys. */
@Global()
@Module({
  providers: [
    {
      provide: EnvelopeCipher,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): EnvelopeCipher => {
        const keys = parseMasterKeys(
          config.get('ENCRYPTION_KEY_ID'),
          config.get('ENCRYPTION_KEY'),
          config.get('ENCRYPTION_PREVIOUS_KEYS') ?? '',
        );
        return new EnvelopeCipher(keys.active, keys.previous);
      },
    },
  ],
  exports: [EnvelopeCipher],
})
export class CryptoModule {}

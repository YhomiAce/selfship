import { Global, Logger, Module } from '@nestjs/common';
import { CloudflareDnsClient } from '@selfship/cloudflare';
import { AppConfigService } from '../config/app-config.service';

/** Injection token for the Cloudflare DNS client (`null` when free subdomains are off). */
export const CLOUDFLARE_CLIENT = Symbol('CLOUDFLARE_CLIENT');

/**
 * Builds the Cloudflare client used for free subdomains.
 *
 * @param config - Validated configuration
 * @returns Client, or null when PLATFORM_APPS_DOMAIN/Cloudflare aren't configured
 */
export function createCloudflareClient(config: AppConfigService): CloudflareDnsClient | null {
  const apiToken = config.get('CLOUDFLARE_API_TOKEN');
  const zoneId = config.get('CLOUDFLARE_ZONE_ID');
  if (!apiToken || !zoneId) {
    new Logger('CloudflareModule').log('Free subdomains are off (Cloudflare not configured)');
    return null;
  }
  return new CloudflareDnsClient({ apiToken, zoneId });
}

/** Provides {@link CLOUDFLARE_CLIENT}. */
@Global()
@Module({
  providers: [
    { provide: CLOUDFLARE_CLIENT, inject: [AppConfigService], useFactory: createCloudflareClient },
  ],
  exports: [CLOUDFLARE_CLIENT],
})
export class CloudflareModule {}

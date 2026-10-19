import { Logger, type Provider } from '@nestjs/common';
import { CloudflareDnsClient } from '@selfship/cloudflare';
import { AppConfigService } from '../config/app-config.service';

/** Injection token for the Cloudflare DNS client (`null` when free subdomains are off). */
export const CLOUDFLARE_CLIENT = Symbol('CLOUDFLARE_CLIENT');

/** Provides {@link CLOUDFLARE_CLIENT} from config. */
export const cloudflareProvider: Provider = {
  provide: CLOUDFLARE_CLIENT,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): CloudflareDnsClient | null => {
    const apiToken = config.get('CLOUDFLARE_API_TOKEN');
    const zoneId = config.get('CLOUDFLARE_ZONE_ID');
    if (!apiToken || !zoneId) {
      new Logger('Domains').log('Free subdomains are off (Cloudflare not configured)');
      return null;
    }
    return new CloudflareDnsClient({ apiToken, zoneId });
  },
};

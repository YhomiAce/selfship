import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, PrismaPg } from '@platform/db';
import { AppConfigService } from '../config/app-config.service';

/**
 * Application-wide Prisma client.
 *
 * Connects when the module starts and disconnects on shutdown. Inject it into
 * repositories/services that need database access.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  /** Opens the connection pool when the module starts. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Closes the connection pool on shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, PrismaPg } from '@selfship/db';
import { AppConfigService } from '../config/app-config.service';

/** Prisma client for the worker (connects on start, disconnects on shutdown). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  /** Opens the connection pool. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Closes the connection pool. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

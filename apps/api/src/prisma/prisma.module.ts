import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Provides a single shared {@link PrismaService} to the whole app. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

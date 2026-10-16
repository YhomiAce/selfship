import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Shared {@link PrismaService}. */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

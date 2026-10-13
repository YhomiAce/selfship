import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

/** Options for {@link createPrismaClient}. */
export interface CreatePrismaClientOptions {
  /** Postgres connection string, e.g. `postgresql://user:pass@host:5432/db`. */
  connectionString: string;
}

/**
 * Creates a Prisma client backed by the `pg` driver adapter.
 *
 * Prisma 7 talks to the database through a driver adapter instead of a
 * bundled query engine, so every client must be created with one.
 *
 * @param options - Connection settings
 * @returns A new, not-yet-connected Prisma client
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({ adapter });
}

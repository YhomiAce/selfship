import { Prisma } from '@platform/db';

/**
 * Checks whether an error is a Prisma unique-constraint violation (P2002).
 *
 * @param error - Any thrown value
 * @returns True for unique-constraint violations
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

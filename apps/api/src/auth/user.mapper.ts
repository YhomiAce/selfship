import type { User } from '@selfship/db';
import type { UserDto } from '@selfship/shared';

/**
 * Converts a database user into the public DTO. Strips the password hash and
 * any other internal fields.
 *
 * @param user - Database user
 * @returns Safe-to-return user representation
 */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    twoFactorEnabled: user.totpEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

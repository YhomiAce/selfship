import { SetMetadata } from '@nestjs/common';

/** Metadata key read by the auth guard. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route or controller as accessible without signing in.
 * Every other route requires a session by default.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

import { z } from 'zod';

/** Email address: trimmed and lower-cased before validation. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254));

/**
 * New password rules. Length beats complexity rules (NIST SP 800-63B), so we
 * only enforce a minimum and a sane maximum (argon2 input limit / DoS guard).
 */
export const PasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.');

/** Display name. */
export const NameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name.')
  .max(80, 'Use at most 80 characters.');

/** Single-use token from an email link (verification / password reset). */
export const EmailTokenSchema = z.string().min(20, 'Invalid link.').max(200, 'Invalid link.');

/** Body of `POST /auth/register`. */
export const RegisterSchema = z.object({
  name: NameSchema,
  email: EmailSchema,
  password: PasswordSchema,
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

/** Body of `POST /auth/login`. Password rules are not re-checked at login. */
export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** Body of `POST /auth/verify-email`. */
export const VerifyEmailSchema = z.object({ token: EmailTokenSchema });
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

/** Body of `POST /auth/forgot-password`. */
export const ForgotPasswordSchema = z.object({ email: EmailSchema });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** Body of `POST /auth/reset-password`. */
export const ResetPasswordSchema = z.object({
  token: EmailTokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/** Public representation of the signed-in user. Never contains secrets. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Whether the user has confirmed their email address. */
  emailVerified: boolean;
  /** False for accounts created via GitHub that never set a password. */
  hasPassword: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Response of endpoints that return the current user. */
export interface AuthUserResponse {
  user: UserDto;
}

/** Response of `GET /auth/providers`: which sign-in methods are enabled. */
export interface AuthProvidersResponse {
  github: boolean;
}

/** Error codes specific to authentication. */
export const AuthErrorCode = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',
  OAUTH_FAILED: 'OAUTH_FAILED',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

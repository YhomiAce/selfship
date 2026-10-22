import { z } from 'zod';

/** A 6-digit code from an authenticator app. */
export const TotpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'));

/** A recovery code (`xxxxx-xxxxx`, case and dashes ignored). */
export const RecoveryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/[^a-z0-9]/g, ''))
  .pipe(z.string().regex(/^[a-z0-9]{10}$/, 'Enter a recovery code like abcde-12345.'));

/** Body of `POST /auth/2fa/verify` (second step of sign-in): a code or a recovery code. */
export const TwoFactorVerifySchema = z.union([
  z.object({ code: TotpCodeSchema }),
  z.object({ recoveryCode: RecoveryCodeSchema }),
]);
export type TwoFactorVerifyInput = z.infer<typeof TwoFactorVerifySchema>;

/** Body of endpoints that need the current code (enable, disable, new recovery codes). */
export const TwoFactorCodeSchema = z.object({ code: TotpCodeSchema });
export type TwoFactorCodeInput = z.infer<typeof TwoFactorCodeSchema>;

/** Response of `POST /auth/2fa/setup`: what to put in the authenticator app. */
export interface TwoFactorSetupResponse {
  /** `otpauth://` URI, shown as a QR code. */
  otpauthUri: string;
  /** The secret in base32, for typing in by hand. */
  secret: string;
}

/** Response of enabling 2FA or regenerating codes: shown once, never again. */
export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

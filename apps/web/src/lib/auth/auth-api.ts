import type {
  AuthProvidersResponse,
  AuthUserResponse,
  ForgotPasswordInput,
  LoginInput,
  LoginResponse,
  RecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorVerifyInput,
  RegisterInput,
  ResetPasswordInput,
  UserDto,
} from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Typed wrappers around the API's `/auth` endpoints.
 * All functions throw `ApiRequestError` on failure.
 */
export const authApi = {
  /** Lists enabled sign-in providers. */
  providers: (): Promise<AuthProvidersResponse> => apiFetch('/auth/providers'),

  /** Creates an account and signs in (sets the session cookie). */
  register: async (input: RegisterInput): Promise<UserDto> =>
    (await apiFetch<AuthUserResponse>('/auth/register', { method: 'POST', json: input })).user,

  /** Signs in with email and password (may ask for a two-factor code next). */
  login: (input: LoginInput): Promise<LoginResponse> =>
    apiFetch('/auth/login', { method: 'POST', json: input }),

  /** Second sign-in step: authenticator code or recovery code. */
  verifyTwoFactor: async (input: TwoFactorVerifyInput): Promise<UserDto> =>
    (await apiFetch<AuthUserResponse>('/auth/2fa/verify', { method: 'POST', json: input })).user,

  /** Starts two-factor setup (secret + QR code URI). */
  setupTwoFactor: (): Promise<TwoFactorSetupResponse> =>
    apiFetch('/auth/2fa/setup', { method: 'POST' }),

  /** Turns two-factor on; returns recovery codes (shown once). */
  enableTwoFactor: (code: string): Promise<RecoveryCodesResponse> =>
    apiFetch('/auth/2fa/enable', { method: 'POST', json: { code } }),

  /** Turns two-factor off. */
  disableTwoFactor: (code: string): Promise<void> =>
    apiFetch('/auth/2fa/disable', { method: 'POST', json: { code } }),

  /** Replaces the recovery codes. */
  regenerateRecoveryCodes: (code: string): Promise<RecoveryCodesResponse> =>
    apiFetch('/auth/2fa/recovery-codes', { method: 'POST', json: { code } }),

  /** Signs out the current session. */
  logout: (): Promise<void> => apiFetch('/auth/logout', { method: 'POST' }),

  /** Returns the signed-in user (throws 401 if not signed in). */
  me: async (): Promise<UserDto> => (await apiFetch<AuthUserResponse>('/auth/me')).user,

  /** Confirms the email from a verification link token. */
  verifyEmail: async (token: string): Promise<UserDto> =>
    (await apiFetch<AuthUserResponse>('/auth/verify-email', { method: 'POST', json: { token } }))
      .user,

  /** Sends a new verification email. */
  resendVerification: (): Promise<void> =>
    apiFetch('/auth/resend-verification', { method: 'POST' }),

  /** Requests a password-reset email. */
  forgotPassword: (input: ForgotPasswordInput): Promise<void> =>
    apiFetch('/auth/forgot-password', { method: 'POST', json: input }),

  /** Sets a new password from a reset-link token. */
  resetPassword: (input: ResetPasswordInput): Promise<void> =>
    apiFetch('/auth/reset-password', { method: 'POST', json: input }),
};

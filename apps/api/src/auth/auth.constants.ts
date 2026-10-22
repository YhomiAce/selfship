/** Lifetime of an email-verification link. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Lifetime of a password-reset link (short, because it grants account access). */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** Lifetime of the OAuth `state` cookie. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Name of the OAuth `state` cookie. */
export const OAUTH_STATE_COOKIE = 'gh_oauth_state';

/** Sessions are extended at most once per this interval, to limit DB writes. */
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** Rate limit for sensitive auth endpoints (per client IP). */
export const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Session cookie names. Production uses the `__Host-` prefix, which makes
 * browsers enforce Secure, Path=/ and no Domain attribute.
 */
export const SESSION_COOKIE = { secure: '__Host-sid', insecure: 'sid' } as const;

/** Time to enter the two-factor code after a correct password. */
export const TWO_FACTOR_TTL_MS = 10 * 60 * 1000;

/** Cookie holding the pending two-factor sign-in challenge (httpOnly). */
export const TWO_FACTOR_COOKIE = 'two_factor_challenge';

/** Recovery codes created at a time. */
export const RECOVERY_CODE_COUNT = 10;

/** Replacement for anything that looks like a secret. */
export const REDACTED = '[redacted]';

/**
 * Secret shapes caught even when we don't know the value (the log writer
 * already masks known env values and tokens; this is the second line of
 * defence before anything is sent to Build Doctor).
 */
const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key IDs
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, // Anthropic/OpenAI-style keys
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe keys
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWTs
];

/** `scheme://user:password@host` → keep the shape, hide the password. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi;

/** `PASSWORD=…`, `api_key: …`, `"secret": "…"`. */
const ASSIGNMENTS =
  /\b([A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi;

/**
 * Removes things that look like credentials from text.
 *
 * @param text - Log lines or file contents
 * @returns The text with secrets replaced by {@link REDACTED}
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) result = result.replace(pattern, REDACTED);
  result = result.replace(URL_CREDENTIALS, `$1:${REDACTED}@`);
  return result.replace(
    ASSIGNMENTS,
    (_whole, key: string, separator: string) => `${key}${separator}${REDACTED}`,
  );
}

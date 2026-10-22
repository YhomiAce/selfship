import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Removes anything sensitive from an error report before it leaves the
 * process: cookies, request bodies, query strings, all headers except the
 * user agent, and user details (they can hold tokens and secrets).
 *
 * @param event - Sentry event
 * @returns The same event, scrubbed
 */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      event.request.headers = { 'user-agent': event.request.headers['user-agent'] ?? '' };
    }
  }
  delete event.user;
  return event;
}

/**
 * Turns on error reporting to Sentry, if a DSN is configured. Without one
 * (self-hosting, local development) nothing is ever sent.
 *
 * @param options - DSN, environment name and which service this is
 */
export function initErrorTracking(options: {
  dsn: string | undefined;
  environment: string;
  service: string;
}): void {
  if (!options.dsn) return;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    initialScope: { tags: { service: options.service } },
    // Errors only: no performance tracing (personal data isn't sent by default).
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  enabled = true;
}

/**
 * Reports an unexpected error (no-op when error tracking is off).
 *
 * @param error - What was thrown
 * @param context - Extra tags (e.g. queue and job name); never secrets
 */
export function reportError(error: unknown, context: Record<string, string> = {}): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: context });
}

/**
 * Sends queued reports before the process exits.
 *
 * @returns Resolves when flushed (or after 2 s)
 */
export async function flushErrorTracking(): Promise<void> {
  if (enabled) await Sentry.flush(2_000);
}

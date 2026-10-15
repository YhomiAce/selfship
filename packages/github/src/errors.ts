/**
 * Error from a GitHub API call.
 *
 * `status` is the HTTP status (0 for network errors/timeouts), so callers can
 * map 404 to "not found", 403 to "no access", and so on.
 */
export class GithubApiError extends Error {
  override name = 'GithubApiError';

  /**
   * @param message - Description, safe to log (never contains tokens)
   * @param status - HTTP status, or 0 when GitHub couldn't be reached
   */
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }

  /** True for 404 responses. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

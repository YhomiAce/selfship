import { createHash } from 'node:crypto';

/** Lines that usually carry the error. */
const ERRORISH =
  /error|err!|fail|cannot|can't|not found|missing|exception|killed|denied|unsupported|invalid/i;

/**
 * Identifies "the same failure": the project type, the failed stage, the
 * error lines with volatile details removed (timestamps, durations, hashes,
 * build step numbers), and package.json. Identical failures reuse one
 * diagnosis instead of paying for another.
 *
 * @param input - Failure details
 * @returns SHA-256 hex digest
 */
export function failureFingerprint(input: {
  adapter: string;
  stage: string | null;
  log: string;
  packageJson: string | null;
}): string {
  const errors = input.log
    .split('\n')
    .filter((line) => ERRORISH.test(line))
    .slice(-20)
    .map((line) =>
      line
        .replace(/^#\d+\s+[\d.]+\s*/, '') // BuildKit "#14 2.907 " prefixes
        .replace(/\b[0-9a-f]{7,64}\b/gi, '<hash>')
        .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<time>')
        .replace(/\d+(\.\d+)?(ms|s)\b/g, '<duration>')
        .replace(/\d+/g, '<n>')
        .trim(),
    );
  return createHash('sha256')
    .update([input.adapter, input.stage ?? '', ...errors, input.packageJson ?? ''].join('\n'))
    .digest('hex');
}

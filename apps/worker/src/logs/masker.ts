/** What a hidden secret looks like in logs. */
export const MASK = '••••••';

/** Values shorter than this aren't masked: "1" or "true" would hide half the log. */
const MIN_SECRET_LENGTH = 4;

/**
 * Hides secret values (env var values, tokens) wherever they appear in text.
 * Multiline secrets are also masked line by line, because build tools often
 * print them one line at a time.
 */
export class Masker {
  private readonly secrets: string[];

  /**
   * @param secrets - Values to hide
   */
  constructor(secrets: Iterable<string>) {
    const all = new Set<string>();
    for (const secret of secrets) {
      for (const part of [secret, ...secret.split('\n')]) {
        const trimmed = part.trim();
        if (trimmed.length >= MIN_SECRET_LENGTH) all.add(trimmed);
      }
    }
    // Longest first, so a secret containing another is masked whole.
    this.secrets = [...all].sort((a, b) => b.length - a.length);
  }

  /**
   * Replaces every secret in `text`.
   *
   * @param text - Any text
   * @returns Text with secrets replaced by {@link MASK}
   */
  mask(text: string): string {
    let result = text;
    for (const secret of this.secrets) {
      if (result.includes(secret)) result = result.split(secret).join(MASK);
    }
    return result;
  }
}

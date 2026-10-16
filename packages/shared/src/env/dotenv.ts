/** One variable read from a `.env` file. */
export interface DotenvEntry {
  key: string;
  value: string;
  /** 1-based line where the variable starts. */
  line: number;
}

/** A line that couldn't be read. */
export interface DotenvError {
  line: number;
  message: string;
}

/** Result of {@link parseDotenv}. Later duplicates win, like most loaders. */
export interface DotenvResult {
  entries: DotenvEntry[];
  errors: DotenvError[];
}

/** Valid variable names: what POSIX shells (and Docker) accept. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Escapes understood inside double quotes. */
const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
  $: '$',
};

/**
 * Parses the contents of a `.env` file the way users expect from dotenv:
 *
 * - blank lines and `# comments` are skipped; `export KEY=value` is accepted
 * - unquoted values are trimmed and end at ` #` (an inline comment)
 * - `'single quotes'` are literal; `"double quotes"` understand `\n`, `\t`, `\"`, `\\`
 * - quoted values may span several lines (e.g. private keys)
 *
 * No variable expansion (`${OTHER}`) is done: values are stored exactly as
 * written, so nothing surprising happens at deploy time.
 *
 * @param text - File contents
 * @returns Variables in file order (duplicates resolved) and per-line errors
 */
export function parseDotenv(text: string): DotenvResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const byKey = new Map<string, DotenvEntry>();
  const errors: DotenvError[] = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      errors.push({ line: lineNo, message: 'Expected KEY=value.' });
      continue;
    }
    const key = match[1] ?? '';
    let rest = match[2] ?? '';
    if (!ENV_KEY_PATTERN.test(key)) {
      errors.push({
        line: lineNo,
        message: `"${key}" isn't a valid name (letters, digits and _, not starting with a digit).`,
      });
      continue;
    }

    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      // Collect lines until the closing quote (multiline values).
      let body = rest.slice(1);
      let closing = findClosingQuote(body, quote);
      while (closing === -1 && index + 1 < lines.length) {
        index++;
        body += `\n${lines[index] ?? ''}`;
        closing = findClosingQuote(body, quote);
      }
      if (closing === -1) {
        errors.push({ line: lineNo, message: `Missing closing ${quote} for ${key}.` });
        continue;
      }
      const after = body.slice(closing + 1).trim();
      if (after && !after.startsWith('#')) {
        errors.push({
          line: lineNo,
          message: `Unexpected text after the closing quote of ${key}.`,
        });
        continue;
      }
      body = body.slice(0, closing);
      rest = quote === '"' ? unescapeDouble(body) : body;
    } else {
      const comment = rest.search(/\s#/);
      rest = (comment === -1 ? rest : rest.slice(0, comment)).trim();
    }

    byKey.delete(key); // re-insert so the last definition keeps its position
    byKey.set(key, { key, value: rest, line: lineNo });
  }
  return { entries: [...byKey.values()], errors };
}

/** Index of the closing quote in `body`, honouring backslash escapes in double quotes. */
function findClosingQuote(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === '\\') {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

/** Applies double-quote escapes; unknown escapes are kept as written. */
function unescapeDouble(body: string): string {
  return body.replace(/\\(.)/g, (whole, char: string) => DOUBLE_QUOTE_ESCAPES[char] ?? whole);
}

/**
 * Whether a variable is normally needed while building rather than at run
 * time: frameworks inline these into the browser bundle.
 *
 * @param key - Variable name
 * @returns True for `NEXT_PUBLIC_*`, `VITE_*` and similar public prefixes
 */
export function isBuildTimeKey(key: string): boolean {
  return /^(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_|GATSBY_)/.test(key);
}

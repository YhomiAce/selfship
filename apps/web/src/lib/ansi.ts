/** A run of text with one style. */
export interface AnsiSegment {
  text: string;
  /** Tailwind classes for the style ('' = default). */
  className: string;
}

/** Foreground colours (30–37, 90–97) for a dark log background. */
const COLORS: Record<number, string> = {
  30: 'text-zinc-500',
  31: 'text-red-400',
  32: 'text-emerald-400',
  33: 'text-amber-300',
  34: 'text-sky-400',
  35: 'text-fuchsia-400',
  36: 'text-cyan-300',
  37: 'text-zinc-200',
  90: 'text-zinc-500',
  91: 'text-red-300',
  92: 'text-emerald-300',
  93: 'text-amber-200',
  94: 'text-sky-300',
  95: 'text-fuchsia-300',
  96: 'text-cyan-200',
  97: 'text-white',
};

/** Matches any escape sequence (CSI …letter); only SGR (`m`) changes the style. */
const ESCAPE = /\u001b\[([0-9;?]*)([A-Za-z])/g;

/**
 * Splits a log line with ANSI colour codes into styled segments. Supports
 * the codes build tools actually use (reset, bold, dim, 16 colours); other
 * escape sequences (cursor movement etc.) are dropped. Output is plain text
 * plus class names, so nothing from the log is ever rendered as HTML.
 *
 * @param line - Raw line
 * @returns Segments in order
 */
export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let color = '';
  let bold = false;
  let dim = false;
  let last = 0;
  const push = (text: string): void => {
    if (!text) return;
    const className = [color, bold ? 'font-bold' : '', dim ? 'opacity-70' : '']
      .filter(Boolean)
      .join(' ');
    const previous = segments.at(-1);
    if (previous && previous.className === className) previous.text += text;
    else segments.push({ text, className });
  };

  for (const match of line.matchAll(ESCAPE)) {
    push(line.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[2] !== 'm') continue;
    const codes = (match[1] ?? '').split(';').map((code) => (code === '' ? 0 : Number(code)));
    for (const code of codes) {
      if (code === 0) {
        color = '';
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) color = '';
      else if (COLORS[code]) color = COLORS[code];
    }
  }
  push(line.slice(last));
  return segments;
}

/**
 * The text of a line without escape codes (for search and copying).
 *
 * @param line - Raw line
 * @returns Plain text
 */
export function stripAnsi(line: string): string {
  return line.replace(ESCAPE, '');
}

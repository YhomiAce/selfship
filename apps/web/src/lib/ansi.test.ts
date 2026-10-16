import { describe, expect, it } from 'vitest';
import { parseAnsi, stripAnsi } from './ansi';

describe('parseAnsi', () => {
  it('returns plain text as one unstyled segment', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', className: '' }]);
  });

  it('styles colours, bold and resets', () => {
    expect(parseAnsi('\u001b[31merror\u001b[0m: \u001b[1;32mok\u001b[22m done')).toEqual([
      { text: 'error', className: 'text-red-400' },
      { text: ': ', className: '' },
      { text: 'ok', className: 'text-emerald-400 font-bold' },
      { text: ' done', className: 'text-emerald-400' },
    ]);
  });

  it('drops non-colour escape sequences and treats ESC[m as reset', () => {
    expect(parseAnsi('\u001b[2K\u001b[1Gnpm \u001b[33mWARN\u001b[m x')).toEqual([
      { text: 'npm ', className: '' },
      { text: 'WARN', className: 'text-amber-300' },
      { text: ' x', className: '' },
    ]);
  });

  it('never produces HTML (text is kept verbatim)', () => {
    expect(parseAnsi('<script>alert(1)</script>')[0]?.text).toBe('<script>alert(1)</script>');
  });
});

describe('stripAnsi', () => {
  it('removes escape codes', () => {
    expect(stripAnsi('\u001b[1m\u001b[31mfail\u001b[0m')).toBe('fail');
  });
});

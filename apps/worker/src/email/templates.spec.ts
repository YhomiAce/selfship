import { escapeHtml, renderEmail } from './templates';

describe('renderEmail', () => {
  it('includes the verification link in text and HTML', () => {
    const email = renderEmail(
      {
        template: 'verify-email',
        to: 'ada@example.com',
        data: { name: 'Ada', verifyUrl: 'http://localhost:3000/verify-email?token=abc' },
      },
      'Selfship',
    );
    expect(email.subject).toBe('Confirm your email for Selfship');
    expect(email.text).toContain('http://localhost:3000/verify-email?token=abc');
    expect(email.html).toContain('href="http://localhost:3000/verify-email?token=abc"');
  });

  it('escapes user-controlled names in HTML', () => {
    const email = renderEmail(
      { template: 'password-changed', to: 'x@y.co', data: { name: '<script>alert(1)</script>' } },
      'Selfship',
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('renders the reset email with its expiry note', () => {
    const email = renderEmail(
      {
        template: 'reset-password',
        to: 'x@y.co',
        data: { name: 'Ada', resetUrl: 'http://x/r?token=t' },
      },
      'Selfship',
    );
    expect(email.text).toContain('expires in 1 hour');
  });
});

describe('escapeHtml', () => {
  it('escapes all special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

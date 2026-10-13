import type { EmailJobData } from '@selfship/shared';

/** A rendered email ready to send. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Escapes text for safe inclusion in HTML (user names are user-controlled).
 *
 * @param value - Untrusted text
 * @returns HTML-escaped text
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Content of one email before it's wrapped in the shared layout. */
interface EmailContent {
  subject: string;
  /** Plain paragraphs (escaped when rendered to HTML). */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Small print under the button. */
  footnote?: string;
}

/**
 * Renders a transactional email from its job payload.
 *
 * Each template produces both a plain-text and an HTML version; the plain
 * text is what spam filters and accessibility tools rely on.
 *
 * @param email - Email job payload (template + data)
 * @param appName - Product name shown in the email
 * @returns Subject, text and HTML bodies
 */
export function renderEmail(email: EmailJobData, appName: string): RenderedEmail {
  return layout(contentFor(email, appName), appName);
}

/** Template-specific wording. */
function contentFor(email: EmailJobData, appName: string): EmailContent {
  switch (email.template) {
    case 'verify-email':
      return {
        subject: `Confirm your email for ${appName}`,
        paragraphs: [
          `Hi ${email.data.name},`,
          `Welcome to ${appName}! Please confirm your email address to finish setting up your account.`,
        ],
        button: { label: 'Confirm email', url: email.data.verifyUrl },
        footnote:
          "This link expires in 24 hours. If you didn't create an account, ignore this email.",
      };
    case 'reset-password':
      return {
        subject: `Reset your ${appName} password`,
        paragraphs: [
          `Hi ${email.data.name},`,
          'We received a request to reset your password. Click the button below to choose a new one.',
        ],
        button: { label: 'Reset password', url: email.data.resetUrl },
        footnote:
          "This link expires in 1 hour. If you didn't ask for a reset, you can ignore this email; your password won't change.",
      };
    case 'password-changed':
      return {
        subject: `Your ${appName} password was changed`,
        paragraphs: [
          `Hi ${email.data.name},`,
          'Your password was just changed and all your sessions were signed out.',
          "If this wasn't you, reset your password immediately and contact support.",
        ],
      };
  }
}

/** Wraps content in the shared plain-text and HTML layouts. */
function layout(content: EmailContent, appName: string): RenderedEmail {
  const { subject, paragraphs, button, footnote } = content;

  const text = [
    ...paragraphs,
    ...(button ? [`${button.label}: ${button.url}`] : []),
    ...(footnote ? [footnote] : []),
    `— The ${appName} team`,
  ].join('\n\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 24px;font-weight:600;font-size:18px;">${escapeHtml(appName)}</p>
      ${paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(p)}</p>`).join('\n      ')}
      ${
        button
          ? `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:500;">${escapeHtml(button.label)}</a></p>
      <p style="margin:0 0 16px;font-size:13px;color:#525252;word-break:break-all;">Or paste this link into your browser: ${escapeHtml(button.url)}</p>`
          : ''
      }
      ${footnote ? `<p style="margin:16px 0 0;font-size:13px;color:#737373;">${escapeHtml(footnote)}</p>` : ''}
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

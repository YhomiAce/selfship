import { EmailJobDataSchema } from './index';

describe('EmailJobDataSchema', () => {
  it('accepts a valid verify-email job', () => {
    const result = EmailJobDataSchema.safeParse({
      template: 'verify-email',
      to: 'ada@example.com',
      data: { name: 'Ada', verifyUrl: 'http://localhost:3000/verify-email?token=abc' },
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['unknown template', { template: 'nope', to: 'a@b.co', data: {} }],
    ['missing data', { template: 'password-changed', to: 'a@b.co' }],
    [
      'data for another template',
      { template: 'reset-password', to: 'a@b.co', data: { name: 'x' } },
    ],
    [
      'invalid recipient',
      { template: 'password-changed', to: 'not-an-email', data: { name: 'x' } },
    ],
    ['null payload', null],
  ])('rejects %s', (_label, payload) => {
    expect(EmailJobDataSchema.safeParse(payload).success).toBe(false);
  });
});

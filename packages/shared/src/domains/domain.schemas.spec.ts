import { AddDomainSchema, DomainHostnameSchema } from './domain.schemas';

describe('DomainHostnameSchema', () => {
  it.each([
    ['App.Example.COM', 'app.example.com'],
    ['example.com.', 'example.com'],
    ['https://shop.example.co.uk/path', 'shop.example.co.uk'],
    ['xn--bcher-kva.example', 'xn--bcher-kva.example'],
  ])('normalises %s', (input, expected) => {
    expect(DomainHostnameSchema.parse(input)).toBe(expected);
  });

  it.each(['localhost', '13.50.208.142', 'exa mple.com', '-bad.example.com', 'example.c', ''])(
    'rejects %p',
    (input) => {
      expect(DomainHostnameSchema.safeParse(input).success).toBe(false);
    },
  );

  it('defaults withWww to false', () => {
    expect(AddDomainSchema.parse({ hostname: 'example.com' })).toEqual({
      hostname: 'example.com',
      withWww: false,
    });
  });
});

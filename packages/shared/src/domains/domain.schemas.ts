import { z } from 'zod';

/** Kinds of domains: our free subdomain, or the user's own. */
export type DomainKind = 'platform' | 'custom';

/** Where a domain is in its setup. */
export type DomainStatus = 'pending_dns' | 'issuing' | 'active' | 'error';

/** Labels for the UI. */
export const DOMAIN_STATUS_LABELS: Record<DomainStatus, string> = {
  pending_dns: 'Waiting for DNS',
  issuing: 'Getting certificate',
  active: 'Active',
  error: 'Needs attention',
};

/**
 * A domain name users can add: lower-cased, trailing dot removed, at least
 * two labels, a real TLD, and not an IP address.
 */
export const DomainHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) =>
    value
      .replace(/\.$/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, ''),
  )
  .pipe(
    z
      .string()
      .min(1, 'Enter a domain, e.g. app.example.com.')
      .max(253, 'That domain is too long.')
      .regex(
        /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/,
        'Enter a domain like app.example.com (letters, digits and dashes).',
      ),
  );

/** Body of `POST /projects/:id/domains`. */
export const AddDomainSchema = z.object({
  hostname: DomainHostnameSchema,
  /**
   * Also add the `www.` version (or, when adding `www.…`, the bare domain),
   * redirecting to the one entered.
   */
  withWww: z.boolean().default(false),
});
export type AddDomainInput = z.infer<typeof AddDomainSchema>;

/** A DNS record the user has to create at their DNS provider. */
export interface DnsRecordInstruction {
  type: 'A' | 'CNAME';
  /** Full name of the record, e.g. `app.example.com`. */
  name: string;
  /** What it points to. */
  value: string;
}

/** Public representation of a domain. */
export interface DomainDto {
  id: string;
  hostname: string;
  kind: DomainKind;
  status: DomainStatus;
  statusMessage: string | null;
  /** Hostname this one redirects to (www ↔ apex), if any. */
  redirectTo: string | null;
  /** What to create at the DNS provider (custom domains). */
  dnsRecords: DnsRecordInstruction[];
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

/** Response of `GET /projects/:id/domains`. */
export interface DomainListResponse {
  items: DomainDto[];
}

/** Error codes specific to domains. */
export const DomainErrorCode = {
  DOMAIN_TAKEN: 'DOMAIN_TAKEN',
  DOMAIN_RESERVED: 'DOMAIN_RESERVED',
  PLATFORM_DOMAIN_LOCKED: 'PLATFORM_DOMAIN_LOCKED',
} as const;

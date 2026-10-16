import { type ParsedKey, utils } from 'ssh2';

/** A generated SSH key pair in OpenSSH formats. */
export interface GeneratedKeyPair {
  /** `-----BEGIN OPENSSH PRIVATE KEY-----…` (store encrypted only). */
  privateKey: string;
  /** One `authorized_keys` line: `ssh-ed25519 AAAA… <comment>`. */
  publicKey: string;
}

/** A pasted key could not be used. */
export class InvalidPrivateKeyError extends Error {
  override name = 'InvalidPrivateKeyError';
}

/**
 * Generates an Ed25519 key pair for one server.
 *
 * The comment identifies the key on the server, so users can revoke it with
 * one command (`sed -i '/<comment>/d' ~/.ssh/authorized_keys`).
 *
 * @param comment - Key comment, e.g. "selfship-3f2a9c1e"
 * @returns Private and public key
 */
export function generateKeyPair(comment: string): GeneratedKeyPair {
  const pair = utils.generateKeyPairSync('ed25519', { comment });
  return { privateKey: pair.private, publicKey: pair.public.trim() };
}

/**
 * Validates a pasted private key and derives its public key.
 *
 * Passphrase-protected keys are rejected: we would have to store the
 * passphrase next to the key, which adds nothing.
 *
 * @param pem - Private key text (OpenSSH or PEM)
 * @param comment - Comment for the derived public key line
 * @returns The normalised private key and its `authorized_keys` line
 * @throws {InvalidPrivateKeyError} If the key can't be parsed or is encrypted
 */
export function inspectPrivateKey(pem: string, comment: string): GeneratedKeyPair {
  const normalised = `${pem.replace(/\r\n/g, '\n').trim()}\n`;
  if (/ENCRYPTED|Proc-Type: 4,ENCRYPTED/.test(normalised)) {
    throw new InvalidPrivateKeyError(
      'This key is protected by a passphrase. Remove it (ssh-keygen -p -N "" -f <key>) or let Selfship generate a key.',
    );
  }
  const parsed = utils.parseKey(normalised);
  if (parsed instanceof Error) {
    const message = /encrypted|passphrase/i.test(parsed.message)
      ? 'This key is protected by a passphrase. Remove it or let Selfship generate a key.'
      : 'This is not a valid SSH private key. Paste the whole file, including the BEGIN and END lines.';
    throw new InvalidPrivateKeyError(message);
  }
  const key: ParsedKey | undefined = Array.isArray(parsed) ? (parsed as ParsedKey[])[0] : parsed;
  if (!key?.isPrivateKey())
    throw new InvalidPrivateKeyError('This is a public key. Paste the private key instead.');
  const publicKey = `${key.type} ${key.getPublicSSH().toString('base64')} ${comment}`;
  return { privateKey: normalised, publicKey };
}

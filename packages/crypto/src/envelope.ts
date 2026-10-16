import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** A master key that encrypts per-secret data keys. */
export interface MasterKey {
  /** Short identifier stored with every ciphertext (enables rotation). */
  id: string;
  /** 32 random bytes. */
  key: Buffer;
}

/** Thrown when a ciphertext can't be decrypted (wrong key, tampering, wrong context). */
export class DecryptionError extends Error {
  override name = 'DecryptionError';
}

/** Serialised format version (bump if the layout ever changes). */
const FORMAT = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Shape of a ciphertext once decoded. */
interface Envelope {
  /** Format version. */
  v: string;
  /** Master key ID used to wrap the data key. */
  k: string;
  /** The data key, encrypted with the master key: iv, ciphertext, tag. */
  dk: [string, string, string];
  /** The secret, encrypted with the data key: iv, ciphertext, tag. */
  d: [string, string, string];
}

/** AES-256-GCM encrypt; returns [iv, ciphertext, tag] as base64url. */
function seal(key: Buffer, plaintext: Buffer, aad: Buffer): [string, string, string] {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ];
}

/** AES-256-GCM decrypt of [iv, ciphertext, tag]; throws on any tampering. */
function open(key: Buffer, parts: [string, string, string], aad: Buffer): Buffer {
  const [iv, ciphertext, tag] = parts.map((part) => Buffer.from(part, 'base64url')) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Envelope encryption for secrets stored in the database.
 *
 * Every secret gets its own random 256-bit **data key**; the data key is
 * encrypted with a **master key** kept outside the database (env var now,
 * KMS/Vault later). A database leak alone therefore reveals nothing.
 *
 * Each ciphertext is bound to a **context** string (e.g. `server:<id>:ssh-key`)
 * via GCM's additional authenticated data, so a ciphertext copied into
 * another row (or used for another purpose) fails to decrypt.
 *
 * Several master keys can be loaded; new ciphertexts use the active one, old
 * ones decrypt with whichever key ID they record. That makes rotation a
 * matter of adding a key, re-encrypting, then removing the old one.
 */
export class EnvelopeCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;

  /**
   * @param active - Key used for new ciphertexts
   * @param previous - Older keys still accepted for decryption
   * @throws {Error} If any key isn't exactly 32 bytes or IDs repeat
   */
  constructor(
    private readonly active: MasterKey,
    previous: readonly MasterKey[] = [],
  ) {
    const all = [active, ...previous];
    for (const { id, key } of all) {
      if (key.length !== 32)
        throw new Error(`Master key "${id}" must be 32 bytes (got ${key.length})`);
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error(`Invalid master key id "${id}"`);
    }
    if (new Set(all.map((k) => k.id)).size !== all.length)
      throw new Error('Master key ids must be unique');
    this.keys = new Map(all.map((k) => [k.id, k.key]));
  }

  /**
   * Encrypts a secret.
   *
   * @param plaintext - Secret value
   * @param context - What the secret is and which record owns it (must match on decrypt)
   * @returns A self-describing, URL-safe string to store in the database
   */
  encrypt(plaintext: string, context: string): string {
    const dataKey = randomBytes(32);
    const aad = Buffer.from(context, 'utf8');
    const envelope: Envelope = {
      v: FORMAT,
      k: this.active.id,
      dk: seal(this.active.key, dataKey, Buffer.from(`${FORMAT}:dek:${context}`)),
      d: seal(dataKey, Buffer.from(plaintext, 'utf8'), aad),
    };
    dataKey.fill(0);
    return `${FORMAT}.${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`;
  }

  /**
   * Decrypts a secret.
   *
   * @param stored - Value produced by {@link encrypt}
   * @param context - Same context used to encrypt
   * @returns The secret
   * @throws {DecryptionError} For unknown keys, wrong context, corruption or tampering
   */
  decrypt(stored: string, context: string): string {
    const envelope = parse(stored);
    const masterKey = this.keys.get(envelope.k);
    if (!masterKey) throw new DecryptionError(`Unknown master key "${envelope.k}"`);
    let dataKey: Buffer | undefined;
    try {
      dataKey = open(masterKey, envelope.dk, Buffer.from(`${FORMAT}:dek:${context}`));
      return open(dataKey, envelope.d, Buffer.from(context, 'utf8')).toString('utf8');
    } catch {
      throw new DecryptionError(
        'Ciphertext could not be decrypted (wrong key or context, or it was modified)',
      );
    } finally {
      dataKey?.fill(0);
    }
  }

  /**
   * Whether a ciphertext was made with an older master key (re-encrypt it).
   *
   * @param stored - Value produced by {@link encrypt}
   * @returns True if not encrypted with the active key
   */
  needsRotation(stored: string): boolean {
    return parse(stored).k !== this.active.id;
  }
}

/** Decodes and shape-checks a stored ciphertext. */
function parse(stored: string): Envelope {
  const [format, body] = stored.split('.', 2);
  if (format !== FORMAT || !body) throw new DecryptionError('Unsupported ciphertext format');
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new DecryptionError('Corrupted ciphertext');
  }
  const isTriple = (x: unknown): x is [string, string, string] =>
    Array.isArray(x) && x.length === 3 && x.every((p) => typeof p === 'string');
  const e = value as Partial<Envelope> | null;
  if (!e || e.v !== FORMAT || typeof e.k !== 'string' || !isTriple(e.dk) || !isTriple(e.d)) {
    throw new DecryptionError('Corrupted ciphertext');
  }
  return e as Envelope;
}

/**
 * Parses master keys from configuration.
 *
 * @param activeId - ID of the key for new ciphertexts (e.g. "k1")
 * @param activeKeyBase64 - 32-byte key, base64 (`openssl rand -base64 32`)
 * @param previous - Older keys as "id:base64,id:base64" (may be empty)
 * @returns Active key and previous keys
 * @throws {Error} If a key isn't valid base64 of exactly 32 bytes
 */
export function parseMasterKeys(
  activeId: string,
  activeKeyBase64: string,
  previous = '',
): { active: MasterKey; previous: MasterKey[] } {
  const decode = (id: string, value: string): MasterKey => {
    const key = Buffer.from(value.trim(), 'base64');
    if (key.length !== 32)
      throw new Error(
        `Encryption key "${id}" must be 32 bytes of base64 (try: openssl rand -base64 32)`,
      );
    return { id, key };
  };
  return {
    active: decode(activeId, activeKeyBase64),
    previous: previous
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [id = '', value = ''] = entry.split(':', 2);
        return decode(id, value);
      }),
  };
}

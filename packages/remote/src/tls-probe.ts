import { connect } from 'node:tls';

/** Outcome of {@link probeCertificate}. */
export interface CertificateProbe {
  /** A trusted certificate valid for the hostname was presented. */
  valid: boolean;
  /** Why not (e.g. Traefik's self-signed default certificate while issuing). */
  reason: string | null;
  /** Expiry of the presented certificate (ISO), when one was presented. */
  validTo: string | null;
}

/**
 * Checks that the server presents a trusted certificate for a hostname.
 * Connects straight to the server's IP with the hostname as SNI, so DNS
 * caches don't matter.
 *
 * @param ipv4 - Server IP
 * @param hostname - Domain to check
 * @param timeoutMs - Connection timeout
 * @returns Whether the certificate is valid
 */
export function probeCertificate(
  ipv4: string,
  hostname: string,
  timeoutMs = 8_000,
): Promise<CertificateProbe> {
  return new Promise((resolve) => {
    const socket = connect({
      host: ipv4,
      port: 443,
      servername: hostname,
      rejectUnauthorized: false,
    });
    const done = (probe: CertificateProbe): void => {
      socket.destroy();
      resolve(probe);
    };
    socket.setTimeout(timeoutMs, () => {
      done({ valid: false, reason: 'timed out connecting on port 443', validTo: null });
    });
    socket.once('error', (error: Error) => {
      done({ valid: false, reason: error.message, validTo: null });
    });
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const validTo = certificate.valid_to ? new Date(certificate.valid_to).toISOString() : null;
      // Untrusted (e.g. Traefik's self-signed default) or issued for another name.
      done({
        valid: socket.authorized,
        reason: socket.authorized ? null : socket.authorizationError.message,
        validTo,
      });
    });
  });
}

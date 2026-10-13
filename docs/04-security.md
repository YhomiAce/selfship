# 04 — Security

We will hold **root-level access to other people's servers**. One breach of our platform = every customer server compromised. Security is the product, not a feature.

## SSH access

1. **Preferred: we generate the key.** Per server, we generate an Ed25519 keypair. The user adds our **public key** with a one-line command. Their own private key never leaves their machine.
2. **Fallback: user pastes a private key.** Encrypt immediately and never log it.
3. **Never store passwords.** If a user only has a root password, use it **once** (in memory) to install our public key, then throw it away.
4. **Verify host keys.** Store the host key fingerprint on first connect. If it changes later, refuse to connect and alert the user.
5. **Least privilege after bootstrap.** Create a `deployer` user in the `docker` group and use that for deploys.
6. Users can **revoke** access at any time. We show the exact command to remove our key.

## Encryption at rest

- SSH private keys, env var values and webhook secrets → **envelope encryption**: each record encrypted with a data key, and data keys encrypted with a master key.
- MVP: master key from an environment variable / secret file, never in git. Later: AWS KMS, GCP KMS or HashiCorp Vault.
- Decrypt only inside the **worker**, only at deploy time, and never send secrets to the frontend after creation (except an explicit "reveal" for env vars, which goes in the audit log).

## GitHub

- GitHub App with **minimum permissions**: Contents (read), Metadata (read), webhooks for push. Add more only when a feature needs it.
- Use short-lived installation tokens per job. Don't persist them.
- **Verify webhook signatures** (`X-Hub-Signature-256`) on every webhook.

## Platform hygiene

- Passwords hashed with argon2. Rate limiting on auth endpoints. Email verification.
- 2FA (TOTP) early, since our users trust us with their servers.
- **Audit log:** who added or removed servers, revealed secrets, deployed, changed domains.
- Never log secrets: scrub env values and keys from build logs (mask known secret values in the log stream).
- Isolate workers from the public internet as much as possible. Only the API is exposed.
- Dependency scanning (Dependabot / `pnpm audit`) in our CI.

## User trust messaging

Show clearly in the UI what we access and why. A page like "How we handle your server credentials" will make a difference to conversion.

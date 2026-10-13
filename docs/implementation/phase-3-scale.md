# Phase 3 — Scale & Differentiate

**Dates:** from 2027-06, ongoing. Ordered by expected value; we'll reprioritise from user data.

## 3.1 Remote builders (paid)
Build on our infra (or the user's GitHub Actions), push to a registry, and the VPS only pulls and runs.
- Fixes the "1 GB VPS can't build Next.js" problem
- Builder pool on cheap cloud instances, per-tenant isolation (rootless BuildKit / microVMs), build cache
- Private registry (per-org namespaces) with retention

## 3.2 Dynamic provisioning ("create a server for me")
- `CloudProvider` interface: `createServer`, `destroyServer`, `listRegions`, `listSizes`
- Implementations: Hetzner, DigitalOcean, AWS (EC2/Lightsail), GCP. User connects their own cloud account (API token / IAM role), or we resell
- Also used internally to **auto-scale the free sandbox pool** (add a sandbox server when the existing ones are full)
- **Go candidate:** this is the first point where a separate **Go service** may make sense. See "When to split out Go" below.

## 3.3 Go agent
A small Go binary installed on user servers during bootstrap:
- Opens an **outbound** connection to us (WebSocket/gRPC), so no inbound SSH access or stored private keys are needed (big security and trust win)
- Reports metrics and container health continuously and runs deploy commands locally
- SSH stays as fallback and for bootstrap

## 3.4 Shared hosting support (SSH, no root, no Docker)
For servers like your Namecheap shared plan:
- **Static / SPA:** build on our remote builder, then upload via `rsync`/SFTP to `public_html`
- **PHP / Laravel:** upload code, run `composer install` remotely if available, set `.htaccess`
- **Node:** use cPanel's "Setup Node.js App" (Passenger) where present
- Pre-flight detects this mode automatically (no sudo, cPanel paths present)
- Depends on remote builders (3.1)

## 3.5 Other
- GitLab and Bitbucket integration
- CLI (`<name> deploy`, `<name> logs`, `<name> env pull`)
- Multiple servers per app + load balancing, cron jobs, background workers as first-class processes
- Marketplace of one-click apps (WordPress, Ghost, n8n, Plausible...)

---

## When to split out Go (decision criteria)

We stay a **modular TypeScript monolith** (api + worker processes) until at least one of these is true:
1. We build the **agent** (3.3). It has to be a single static binary, which is a Go strength
2. Provisioning/orchestration needs long-lived, highly concurrent connections (thousands of servers) where Node workers struggle
3. A contributor/team member with Go expertise owns that service

Until then, provisioning code lives in `packages/provisioning` behind the `CloudProvider` interface, so moving it to a Go service later only replaces the implementation behind a queue, not the callers.

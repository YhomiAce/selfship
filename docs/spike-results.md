# Deploy spike results (M3)

**Date:** 2026-10-15 · **Script:** [`tools/deploy-spike`](../tools/deploy-spike/README.md) · **Servers:** AWS `eu-north-1`, Ubuntu 24.04.5, Docker 29.9.1, Traefik v3

The spike connects over SSH, runs pre-flight checks, bootstraps the server (Docker, swap, firewall, Traefik), then deploys a GitHub repo: clone → detect (M2 adapters) → generated Dockerfile → build → start → health check → zero-downtime switch.

## Results

| App (repo)                                                             | Server              | Clone | Build     | Start | Total | Peak RAM in use | Peak swap  |
| ---------------------------------------------------------------------- | ------------------- | ----- | --------- | ----- | ----- | --------------- | ---------- |
| Static HTML (`cloudacademy/static-website-example`)                    | 2 GB (t3.small)     | 2.5 s | 6.5 s     | 4.6 s | 21 s  | 535 MB          | 0          |
| Vite React SPA (`vitejs/vite` → `packages/create-vite/template-react`) | 2 GB                | 3.1 s | 20.0 s    | 2.5 s | 31 s  | 805 MB          | 0          |
| Next.js (`vercel/next.js` → `examples/hello-world`)                    | 2 GB                | 3.7 s | 73.3 s    | 5.1 s | 88 s  | 1057 MB         | 0          |
| Static HTML                                                            | **1 GB** (t3.micro) | 3.2 s | 7.0 s     | 8.2 s | 24 s  | 434 MB          | 21 MB      |
| Vite React SPA                                                         | **1 GB**            | 3.6 s | 22.6 s    | 8.2 s | 40 s  | 511 MB          | 140 MB     |
| Next.js                                                                | **1 GB**            | 4.2 s | 99.8 s    | 9.5 s | 121 s | 738 MB          | **336 MB** |
| Next.js redeploy, same commit (build cache)                            | 2 GB                | 3.9 s | **1.8 s** | 3.9 s | 22 s  | 746 MB          | 0          |

"Peak RAM in use" is the whole server (OS + Docker + Traefik + apps already running + the build), sampled every second.

### Baseline and running cost

| Measure                                          | Value                                               |
| ------------------------------------------------ | --------------------------------------------------- |
| Fresh bootstrap                                  | ~60 s (Docker install dominates)                    |
| Bootstrap re-run (already set up)                | ~9 s, every step skipped                            |
| Idle RAM after bootstrap (OS + Docker + Traefik) | ~500 MB on AWS's Ubuntu image (includes AWS agents) |
| Docker overhead                                  | dockerd ~104 MB + containerd ~58 MB                 |
| Traefik                                          | 15 MB idle, ~56 MB after handling TLS               |
| Running static/SPA site (nginx)                  | **< 1 MB each**                                     |
| Running Next.js hello-world                      | ~174 MB                                             |
| Sparse clone of a huge monorepo (vercel/next.js) | 3–4 s                                               |

### Zero-downtime redeploys

Requests sent every ~100 ms (through Traefik) during redeploys:

| Attempt                                | Result             |
| -------------------------------------- | ------------------ |
| First version (no Docker health check) | 23 ok, **1 × 502** |
| With Docker health check — Next.js     | 35 ok, 0 failed    |
| With Docker health check — static      | 23 ok, 0 failed    |
| With Docker health check — Vite SPA    | 34 ok, 0 failed    |

## Findings

1. **Traefik routes to a container as soon as it starts**, before the app listens, which caused the 502. Fix: every container gets a Docker `HEALTHCHECK` (`nc -z 127.0.0.1 <port>` in our Alpine-based images); Traefik ignores containers until Docker reports them healthy. Custom Dockerfiles keep their own `HEALTHCHECK` (if they have none, a short gap is still possible: document it and recommend adding one).
2. **1 GB + 2 GB swap is enough for small Next.js apps**, ~35 % slower to build and leaning on swap. Real-world Next.js apps are bigger: recommend 2 GB for Next.js, keep 1 GB as "works, slower". Remote builds (Phase 3) remain the answer for tiny servers.
3. **Static/SPA sites are almost free to run** (< 1 MB each), so one small server can host many of them, which suits the free sandbox.
4. **Idle baseline is ~500 MB** on AWS's Ubuntu image. A 512 MB "static-only" tier is too tight on AWS images; leaner VPS images (Hetzner, DigitalOcean) may differ. Re-test on a 512 MB VPS before promising that tier.
5. **Build cache makes redeploys of unchanged code fast** (build 1.8 s). Keeping the last 3 images per app (done) enables instant rollback.
6. **Docker 29.9 + `traefik:v3` work together** in these tests. Pin the Traefik version in production so an upstream release can't change behaviour unexpectedly.
7. **Firewall:** ufw allows the SSH port first, then 80/443. Docker-published ports bypass ufw, but only Traefik publishes ports, so app containers are unreachable except through Traefik.

## Not yet verified

- **Real Let's Encrypt certificates.** The `spike.selfship.dev` DNS records weren't in place yet, so these runs used Let's Encrypt **staging** and were checked with `curl --resolve -k` (Traefik's default certificate). Re-run with production ACME once DNS exists, deleting `/opt/selfship/traefik/acme.json` first (it holds the staging account).
- 512 MB servers, Debian 12/13, arm64.

## Decisions for the product (M3/M4)

- Bootstrap script and deploy steps move into the worker almost as-is (SSH wrapper, pre-flight, bootstrap, remote snapshot, deploy, memory sampling).
- Docker health check on every container, and wait for "healthy" before switching (finding 1).
- Capability tiers: **< 1 GB: static only (unverified)**, **1–2 GB: standard (swap added)**, **≥ 2 GB: recommended** (Next.js), as planned.

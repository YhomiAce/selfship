# Deploy spike

A standalone script that proves Selfship's deploy flow on a real server, and the blueprint for the worker's deploy engine. Results: [docs/spike-results.md](../../docs/spike-results.md).

```bash
pnpm --filter @selfship/deploy-spike spike check     --host 1.2.3.4
pnpm --filter @selfship/deploy-spike spike bootstrap --host 1.2.3.4 [--acme-email you@x.com] [--staging]
pnpm --filter @selfship/deploy-spike spike deploy    --host 1.2.3.4 --repo https://github.com/owner/repo \
     --domain app.example.com [--ref main] [--root-dir apps/web] [--app name] [--probe]
```

Common options: `--user ubuntu`, `--key ~/.ssh/id_rsa`, `--port 22`, `--fingerprint SHA256:…` (pin the host key).

| Command     | What it does                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`     | Pre-flight only: OS, architecture, RAM/swap/disk, sudo, Docker, ports 80/443 in use. Changes nothing                                                    |
| `bootstrap` | Idempotent setup: Docker ≥ 23, 2 GB swap if RAM < 2 GB, ufw (SSH, 80, 443), Traefik with Let's Encrypt                                                  |
| `deploy`    | Clone → detect → build → start next to the old version → wait healthy → remove old version. `--probe` requests the site throughout and reports failures |

Use `--staging` until the domain's DNS points at the server, so failed certificate attempts don't hit Let's Encrypt's production rate limits.

## Files

The SSH, pre-flight, bootstrap, remote-snapshot and memory-sampling code now lives in [`packages/remote`](../../packages/remote/), shared with the worker. The spike only keeps:

| File            | What                                            |
| --------------- | ----------------------------------------------- |
| `src/cli.ts`    | Command-line entry point and the `--probe` test |
| `src/deploy.ts` | Deploy steps (move into the worker in M4)       |

Runs with Node's built-in TypeScript support (`--experimental-strip-types`), so there is no build step.

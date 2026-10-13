# 02 — Architecture

## High-level picture

```
                    ┌──────────────────────────── OUR PLATFORM ───────────────────────────┐
                    │                                                                     │
 User's browser ───►│  Next.js (web)  ──►  NestJS API  ──►  PostgreSQL                    │
        ▲           │                        │   ▲                                        │
        │ live logs │                        │   │ status / logs (Redis pub-sub)          │
        └───────────┤  WebSocket ◄───────────┘   │                                        │
                    │                        ▼   │                                        │
 GitHub ──webhook──►│  API  ──enqueue──►  Redis (BullMQ)  ──►  Worker(s)                  │
                    │                                            │                        │
                    └────────────────────────────────────────────┼────────────────────────┘
                                                                 │ SSH (ssh2)
                                                                 ▼
                    ┌──────────────────── USER'S VPS (Hostinger, AWS, ...) ───────────────┐
                    │  Docker                                                             │
                    │   ├── traefik  (ports 80/443, auto SSL via Let's Encrypt)           │
                    │   ├── app-a    (container, Traefik labels → app-a.com)              │
                    │   ├── app-b    (container, Traefik labels → api.app-b.com)          │
                    │   └── postgres (optional, Phase 2)                                  │
                    └─────────────────────────────────────────────────────────────────────┘
```

## Core domain entities (first draft)

```
User ─┬─< Server            (ip, port, ssh user, encrypted private key, host key fingerprint, status)
      ├─< GitHubInstallation (installation id, account login)
      └─< Project / App      (repo, branch, root dir, framework, build/start cmd, port)
              ├─< EnvVar     (key, encrypted value, scope: build|runtime)
              ├─< Domain     (hostname, verified, ssl status)
              └─< Deployment (commit sha, status, logs, image tag, started/finished)
```

Each App is deployed to one Server. Later: teams/organizations owning resources.

## Key flows

### 1. Connect GitHub (GitHub App)
1. User clicks "Connect GitHub" and is sent to our GitHub App install page.
2. User picks **which repos** we can access (all or selected).
3. GitHub redirects back with an `installation_id`, which we store.
4. To list repos or clone, we create a **short-lived installation token** (valid 1 hour). We never store long-lived user tokens.
5. GitHub sends **push webhooks** to `/webhooks/github`, which trigger auto-deploys.

> Why a GitHub App instead of an OAuth App: fine-grained per-repo access, tokens that expire, webhooks included, and it reads as more trustworthy to users ("only these 3 repos").

### 2. Add a server
1. User enters IP, SSH port and username.
2. **Recommended:** we generate a keypair, the user runs one copy-pasted command on their server to add our public key, and we never see their private key.
   **Alternative:** the user pastes their own private key (encrypted at rest).
3. We connect, record the **host key fingerprint** (to detect MITM later), and check the OS, RAM, disk and root/sudo access.
4. **Bootstrap job:** install Docker, create the `traefik` network and container, configure the firewall (22/80/443), add swap if RAM < 2 GB, and enable unattended security upgrades.
5. Server status becomes ✅ Ready.

### 3. Deploy an app
1. User picks a repo + branch + server. We **detect the framework** and pre-fill the build/start command and port, which the user can override.
2. User adds env vars (form, or paste a `.env` file).
3. Click Deploy. The API creates a `Deployment` row and enqueues a job.
4. The worker picks up the job and opens SSH:
   1. `git clone --depth 1` the commit using an installation token
   2. Write a generated Dockerfile (if the repo doesn't have one)
   3. `docker build`, streaming output to Redis, then to WebSocket, then to the browser
   4. Start the new container with Traefik labels and env vars
   5. Health check. If it passes, stop the old container (zero-downtime). If it fails, keep the old one running and mark the deployment failed
   6. Prune old images, keeping the last 3 for rollback
5. Status → ✅ Live, with the URL.

### 4. Custom domain
1. User adds `myapp.com`. We show: "Create an **A record** pointing to `<server IP>`".
2. We poll DNS until it resolves to the server.
3. Update the container's Traefik labels. Traefik gets a Let's Encrypt certificate automatically.
4. Bonus: every app also gets a **free subdomain** right away (`myapp-x7k.ourplatform.app`). We create that DNS record through our own DNS provider's API (e.g. Cloudflare), so users get HTTPS before they own a domain.

## Why a queue + separate worker

- Deploys take minutes. HTTP requests shouldn't wait that long.
- If the API restarts, jobs aren't lost.
- We can scale workers on their own and limit concurrency (e.g. one deploy per server at a time).
- Retries and timeouts come built in with BullMQ.

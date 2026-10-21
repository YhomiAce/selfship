# 09 — Free Tier Sandbox ("Try it now")

Users without a server can deploy right away to **servers we own**. Without this, a new user has to go and buy a VPS before they see any value, and many won't.

## Approach: shared sandbox servers, not a VM per user

| Option                                                           | Cost                                              | Complexity                          | Verdict                            |
| ---------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------- | ---------------------------------- |
| Create a cloud VM per free user (AWS/GCP API)                    | $4–10/user/month                                  | High (provisioning, cleanup)        | ❌ Too expensive on a small budget |
| **A few platform-owned VPSes running many small app containers** | ~€5–10/month per server, hosting 20–50 small apps | Low: reuses our deploy engine as-is | ✅ **MVP**                         |
| Auto-scaled sandbox pool via cloud APIs                          | Scales with demand                                | Medium                              | Phase 3 (dynamic provisioning)     |

A sandbox server is just a `Server` row with `isPlatformSandbox = true` and `ownerId = null`. The same bootstrap and deploy code runs on it. No new engine is needed.

**Provider:** a cheap, reliable VPS (Hetzner / DigitalOcean / Vultr / AWS Lightsail). AWS/GCP free tiers are small and time-limited, so they work for testing but not for a lasting free tier.

## Limits (draft, tune with spike data)

| Limit                  | Value                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| Apps per user          | 1 (verified email required)                                                      |
| App types              | Static, SPA, small Node APIs. Next.js only if the spike shows builds fit         |
| Container memory / CPU | 256 MB / 0.25 vCPU (`--memory`, `--cpus`, `--pids-limit`)                        |
| Build                  | Concurrency 1 per sandbox server, 10 min timeout, memory cap                     |
| Lifetime               | 7 days, extendable once. Then "move it to your own server"                       |
| Sleep                  | Stopped after 24 h without traffic, woken on next deploy (wake-on-request later) |
| Domain                 | Platform subdomain only                                                          |
| Bandwidth              | Rate limited via Traefik middleware                                              |

## Abuse protection (running strangers' code is risky)

- Containers: non-root user, no `--privileged`, drop all capabilities, `no-new-privileges`, read-only root FS where possible, separate Docker network per app (apps can't reach each other)
- Block outbound SMTP (spam) and limit outbound connections. Detect crypto-mining by CPU usage patterns and kill it
- Verified email + GitHub account age check. Captcha on signup
- Kill switch: admin can suspend a user/app instantly
- Later: gVisor (`runsc`) runtime for stronger isolation on sandbox servers

## What's implemented (M6)

Limits, isolation, policy and onboarding as above, except: sleeping after inactivity (deferred, needs traffic data), GitHub account age checks, captcha, crypto-mining detection, gVisor and an admin kill switch (a server can be taken out of the sandbox with `pnpm --filter @selfship/api sandbox-server <id> off`). The outbound mail block is an `iptables` rule re-applied on every sandbox deployment (it doesn't survive a reboot until the next deployment).

## Upgrade path

The sandbox is the funnel: **try free → connect your own VPS (free plan) → pay per app for features.** One-click "Move to my server" re-deploys the same project to the user's server.

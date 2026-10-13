# 00 — Vision & Positioning

## The one-liner

> Vercel-style "connect GitHub → deploy" for **your own cheap VPS**.

## The problem

Developers, especially freelancers, small agencies and indie hackers, buy a cheap VPS (Hostinger, Namecheap, WhoGoHost, Contabo, DigitalOcean...) because it costs much less than Vercel, Render or Heroku. Then they get stuck:

- SSH in, install Node/PHP/Java, set up PM2 or systemd
- Write an Nginx config, set up SSL with certbot
- Point the domain, debug DNS
- Redo all of it by hand on every update, with no rollback when something breaks

Most of them follow a YouTube tutorial once and then dread every deploy.

## The solution

1. Sign up and connect GitHub.
2. Add a server by pasting its IP and adding our public key (or pasting a private key).
3. We **bootstrap** the server: Docker, reverse proxy, firewall, SSL.
4. Pick a repo and branch. We detect the framework, build it, and run it.
5. Add env vars (one by one, or paste a `.env` file).
6. Add a custom domain and SSL is issued automatically. Every push to the branch redeploys.

## Who it's for (in priority order)

1. **Freelancers & small agencies** deploying client sites to cheap VPSes. They have many sites, little time, and feel the pain most.
2. **Indie hackers / students** who want Vercel-like DX at VPS prices.
3. **Small companies** in markets where USD-priced PaaS is expensive (e.g. Nigeria and wider Africa). Local pricing and payment (Paystack/Flutterwave) could be a real edge here.

## Competitors (know them, learn from them)

| Product                                      | Model                                        | Notes                                                                      |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| **Coolify**                                  | Open-source, self-hosted (paid cloud option) | Closest to our idea. Study it closely.                                     |
| **Dokploy**                                  | Open-source, self-hosted                     | Docker + Traefik, very similar architecture                                |
| **CapRover**                                 | Open-source, self-hosted                     | Older, Docker Swarm based                                                  |
| **Kamal** (37signals)                        | CLI tool                                     | Docker deploys over SSH, zero-downtime. Good reference for the deploy flow |
| **Laravel Forge / Ploi / RunCloud / Cleavr** | SaaS, BYO server                             | Proves people **pay** for "manage my VPS". Mostly PHP-focused              |
| **Vercel / Netlify / Render / Railway**      | Fully managed PaaS                           | The DX bar we want to match, but they host the app themselves              |

**Takeaway:** Forge/Ploi prove the business model (SaaS + your own server). Coolify/Dokploy prove the tech (Docker + Traefik over SSH). Our angle:

- **Hosted SaaS**, so users don't need to install or maintain anything (unlike Coolify self-hosted)
- **Multi-language**, not PHP-first like Forge
- **Beginner-friendly**: explain every step and fail with clear, human error messages
- **Local market fit**: local currency pricing, local payments, support in the user's timezone

## Important reality check: shared hosting vs VPS

Hostinger, Namecheap and GoDaddy sell two very different things:

- **Shared / cPanel hosting**: no root access and usually no Docker. **We cannot support this** (or at most static/PHP via FTP, which is a different product).
- **VPS / cloud servers**: full root SSH. **This is our target.**

The onboarding UI has to make this clear ("You need a VPS with Ubuntu 22.04+ and root access").

## What success looks like (first 6 months)

- A developer goes from sign-up to a live HTTPS URL in **under 10 minutes**
- 50 active users, 10 paying
- Deploys succeed for the top frameworks (static, Node, Next.js, React/Vue SPA) on a 1–2 GB VPS

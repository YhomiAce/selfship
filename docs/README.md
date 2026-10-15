# Selfship Planning Docs

Product name: **Selfship** (decided 2026-10-14, see decision log #36).

A platform for deploying any app from GitHub to **your own server** (a VPS from Hostinger, Namecheap, WhoGoHost, GoDaddy, or AWS/GCP). Paste your server details, pick a repo, click deploy. We set up the build, the reverse proxy, SSL, and domains for you.

## Read in this order

| #   | Doc                                                                                                  | What it covers                                                          |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 00  | [Vision & positioning](00-vision.md)                                                                 | What we're building, who it's for, competitors, how we stand out        |
| 01  | [Tech stack](01-tech-stack.md)                                                                       | What we build the platform with, and why                                |
| 02  | [Architecture](02-architecture.md)                                                                   | System components and how a deployment flows through them               |
| 03  | [Deployment engine](03-deployment-engine.md)                                                         | Docker, build detection, adapters, Traefik, SSL, domains                |
| 04  | [Security](04-security.md)                                                                           | Handling SSH keys, env vars, GitHub tokens                              |
| 05  | [MVP scope & roadmap](05-roadmap.md)                                                                 | What goes in v1, what waits, and the phases                             |
| 06  | [Open questions](06-open-questions.md)                                                               | Things we still need to decide                                          |
| 07  | [Coding standards](07-coding-standards.md)                                                           | Types, DTOs, comments, module structure, testing                        |
| 08  | [Build Doctor (AI)](08-ai-build-doctor.md)                                                           | Claude-powered diagnosis of failed builds                               |
| 09  | [Free tier sandbox](09-free-tier-sandbox.md)                                                         | "Try it now" without owning a server                                    |
| 10  | [Local development](10-local-development.md)                                                         | Run the platform on your machine: ports, env, commands                  |
| --  | [**Implementation plan**](implementation/README.md)                                                  | Phases 0–3 broken into dated milestones and tasks                       |
| --  | [Code walkthrough: GitHub, projects, deploy spike](walkthroughs/m2-m3-github-projects-and-deploy.md) | Every flow from UI click to database and server, with links to the code |
| --  | [Decision log](decision-log.md)                                                                      | Every decision we make, with the reason                                 |
| --  | [Discussion log](discussion-log.md)                                                                  | Notes from each planning session                                        |

## How we use these docs

- Each decision goes in the **decision log** with the date and the reason, so we can come back later and see _why_.
- Each planning session gets a short entry in the **discussion log**.
- Once a question in `06-open-questions.md` is answered, move it to the decision log.

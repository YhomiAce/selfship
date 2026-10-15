# Implementation Plan

This folder turns the [roadmap](../05-roadmap.md) into concrete, dated work.

| Phase | Doc                                   | Dates (target)          | Outcome                                                         |
| ----- | ------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| 0     | [Foundations](phase-0-foundations.md) | 2026-10-13 → 2026-10-26 | Monorepo, CI, app skeletons running locally                     |
| 1     | [MVP](phase-1-mvp.md)                 | 2026-10-27 → 2027-02-14 | Public beta: GitHub → VPS → HTTPS, Build Doctor, free sandbox   |
| 2     | [Widen](phase-2-widen.md)             | 2027-02-15 → 2027-05-30 | Billing, more languages, databases, teams, monitoring           |
| 3     | [Scale](phase-3-scale.md)             | 2027-06 → ongoing       | Remote builders, Go agent, dynamic provisioning, shared hosting |

## Working agreement

- **Claude** writes all code, tests and docs, one milestone at a time, in small reviewable PRs.
- **Founder** (~20 h/week) reviews PRs, runs the app locally, tests on a real VPS, and decides product questions.
- Each milestone ends with a **demo checklist** ("What you'll test"). A milestone is done when every item on it passes on your machine and a real VPS.
- The dates assume ~2 weeks per milestone. If a milestone slips, we cut scope before we move dates, unless the scope is critical.

## Definition of Done (every PR)

- [ ] Follows [coding standards](../07-coding-standards.md): typed DTOs, explicit types, TSDoc on every method
- [ ] Lint, typecheck and tests pass in CI
- [ ] New behaviour has tests (unit, plus integration where it touches DB, queue or SSH)
- [ ] No secrets in code, logs or test fixtures
- [ ] Docs updated if behaviour or setup changed
- [ ] Decision log updated if we made a decision

## Branching & releases

- `main` is always deployable. Feature branches go `feat/<milestone>-<short-name>`, with a PR, review and squash merge.
- Conventional commits (`feat:`, `fix:`, `docs:` ...) let us auto-generate the changelog.
- Tag `v0.x.0` at the end of each milestone.

## What the founder needs to set up (and when)

| When         | Item                                             | Notes                                                                      |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Phase 0      | GitHub org + public repo                         | Name can be a placeholder and renamed later                                |
| Phase 1 · M3 | Test VPS (`make up` in `infra/aws/test-servers`) | Terraform is ready, run only during test sessions                          |
| Phase 1 · M3 | A domain on **Cloudflare**                       | Any cheap domain works for now. Used for the spike and platform subdomains |
| Phase 1 · M1 | Email sending account (e.g. Resend / Postmark)   | Dev uses Mailpit locally, so this is only needed for staging               |
| Phase 1 · M2 | **GitHub App** registered                        | Guide: [github-app-setup.md](../guides/github-app-setup.md)                |
| Phase 1 · M5 | Cloudflare API token (DNS edit, one zone)        | For platform subdomains                                                    |
| Phase 1 · M6 | **Anthropic API key** from the Claude Console    | For the Build Doctor. See [08](../08-ai-build-doctor.md)                   |
| Phase 1 · M6 | One VPS for the **free sandbox**                 | About €5–10/month, hosts many small free apps                              |
| Phase 1 · M7 | Production VPS for the platform itself           | 4 GB RAM is plenty at launch                                               |
| Phase 2      | Stripe account (test mode)                       | Payment provider is abstracted. See [Phase 2](phase-2-widen.md)            |

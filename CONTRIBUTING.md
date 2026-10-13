# Contributing

Thanks for your interest! The project is in early development, so expect things to move fast.

## Workflow

1. Create a branch: `feat/<short-name>` or `fix/<short-name>`
2. Follow the [coding standards](docs/07-coding-standards.md): typed DTOs (zod schemas in `packages/shared`), explicit types, TSDoc on every method
3. Add tests for new behaviour
4. Run `pnpm lint && pnpm typecheck && pnpm test` before pushing
5. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:` ...). A commit hook checks this
6. Open a PR describing **what** changed, **why**, and **how to test** it

## Decisions

Significant technical or product decisions are recorded in [docs/decision-log.md](docs/decision-log.md). If your change involves one, add an entry.

# 07 — Coding Standards

These rules apply to every PR. CI enforces most of them.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **No `any`.** Use `unknown` and narrow it. (`@typescript-eslint/no-explicit-any: error`)
- **Explicit types on every method signature**: parameters and return type (`explicit-function-return-type`, `explicit-module-boundary-types`)
- Prefer `type` aliases for data and `interface` for contracts that classes implement (e.g. `Adapter`, `CloudProvider`, `PaymentProvider`)
- No default exports (except where Next.js requires them: pages/layouts)
- Use the **Result / typed error** pattern in domain code. Throw Nest `HttpException` subclasses only at the controller boundary

## Request & response bodies: one source of truth

All request/response shapes are **zod schemas in `packages/shared`**. Types are inferred from them, and both the API and the web app import them.

```ts
// packages/shared/src/projects/create-project.schema.ts
import { z } from 'zod';

/** Body for POST /projects. */
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(64),
  repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  branch: z.string().min(1),
  rootDir: z.string().default('/'),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
```

```ts
// apps/api/src/projects/dto/create-project.dto.ts
import { createZodDto } from 'nestjs-zod';
import { CreateProjectSchema } from '@selfship/shared';

/** Validated DTO for creating a project. */
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
```

The web app uses the same schema with `react-hook-form` + `zodResolver`, so validation rules exist in exactly one place.

## Comments: TSDoc on every method

Every class, public method and exported function gets a TSDoc block: **what** it does, its params, its return value, and what it throws. Inline comments explain **why**, not what.

```ts
/**
 * Starts a new deployment for a project on its assigned server.
 *
 * Creates the Deployment record and enqueues the build job; the actual
 * work happens asynchronously in the worker.
 *
 * @param userId - ID of the user requesting the deploy (must own the project)
 * @param projectId - Project to deploy
 * @param trigger - What initiated the deploy (manual, push webhook, rollback)
 * @returns The created deployment in `queued` state
 * @throws {NotFoundException} If the project does not exist or is not owned by the user
 * @throws {ConflictException} If a deployment is already running for this project
 */
async createDeployment(
  userId: string,
  projectId: string,
  trigger: DeploymentTrigger,
): Promise<DeploymentDto> { ... }
```

## NestJS module structure

One feature = one module. Controllers stay thin, services hold the logic, and the database is accessed only through repositories/Prisma inside the module.

```
apps/api/src/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts     # HTTP only: parse, call service, map response
├── <feature>.service.ts        # Business logic
├── <feature>.repository.ts     # Prisma queries (optional for simple modules)
├── dto/                        # createZodDto wrappers
└── <feature>.service.spec.ts
```

- Modules talk to each other through **exported services**, never by reaching into another module's repository
- Cross-process work (api → worker) always goes through **BullMQ job types defined in `packages/shared`** (typed payloads)
- Config only through the typed `ConfigService`, never `process.env` directly

## Naming

- Files: `kebab-case.ts`. Classes: `PascalCase`. Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`
- Booleans read as questions: `isVerified`, `hasCustomDomain`
- DB tables: Prisma models `PascalCase` singular, mapped to `snake_case` plural tables

## Testing

- **Unit:** services, adapters, parsers (Jest). Adapters use fixture repos in `packages/adapters/fixtures/`
- **Integration:** API + real Postgres/Redis in CI (Testcontainers or service containers)
- **SSH/deploy:** an integration suite that runs against a disposable VPS or a local Docker-in-Docker "fake server". Run nightly, not on every PR
- **E2E (web):** Playwright for the critical paths (sign up → deploy) from M7

## Untrusted data and safe property access

TypeScript types are only promises. At runtime, data that comes **from outside the process** can be missing, `null`, an array instead of a string, or a different shape entirely. Validate it once at the boundary, then trust the types inside.

| Source                                | Rule                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request bodies                        | zod DTOs (global `ZodValidationPipe`)                                                                                                                                                             |
| Query params, cookies, headers        | Read through `queryString()` / `readCookie()` (`apps/api/src/common/http.ts`) or check `typeof`. Express query values can be arrays or objects, and cookie-parser turns `j:` cookies into objects |
| JSON from external APIs (GitHub, ...) | `schema.safeParse(await res.json().catch(() => null))`, and every `fetch` gets `signal: AbortSignal.timeout(...)`                                                                                 |
| Job payloads (Redis)                  | Validate with the zod schema from `packages/shared`. Throw `UnrecoverableError` for bad payloads so they aren't retried                                                                           |
| Env vars                              | zod env schema at startup                                                                                                                                                                         |
| API responses in the web app          | Go through `apiFetch`, which turns every failure (network, non-JSON, malformed error) into `ApiRequestError`                                                                                      |

Inside the app, **don't sprinkle `?.` on values whose type says they exist.** It hides real bugs, and `no-unnecessary-condition` rejects it. Use `?.` / `??` where the type includes `undefined`/`null` (optional fields, `noUncheckedIndexedAccess` lookups, `Map.get`). Avoid `as` casts on untrusted data; parse it instead.

## Security rules in code

- Never log request bodies on auth/server/env endpoints
- Secrets are typed as `Secret<string>` (a wrapper whose `toString()`/`toJSON()` returns `"[redacted]"`) so they can't leak through logs or responses by accident
- All shell commands sent over SSH are built with a **command builder that escapes arguments**. Never concatenate user input into a shell string

## Git

- Conventional commits, small PRs (< ~400 lines changed where possible), and a PR description that says what changed, why, and how to test

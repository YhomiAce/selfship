# Code walkthrough: GitHub integration, projects and the deploy spike (M2 + start of M3)

This document follows the code path for everything built in M2 (GitHub App, detection, projects) and the first part of M3 (the deploy spike). It explains what happens from the moment a user clicks a button until data is saved, which process does what, and why it was built that way. Every step links to the file and line where the logic lives, so you can trace it in your editor.

> Line numbers are from branch `feat/m3-servers` at the time of writing. If a line has moved, search for the function name next to it.

---

## Contents

1. [The big picture: who talks to whom](#1-the-big-picture-who-talks-to-whom)
2. [Where the code lives](#2-where-the-code-lives)
3. [What every API request goes through](#3-what-every-api-request-goes-through)
4. [Flow A: Connect GitHub](#4-flow-a-connect-github)
5. [Flow B: Browse and search repositories](#5-flow-b-browse-and-search-repositories)
6. [Flow C: Select a repository → detect the framework](#6-flow-c-select-a-repository--detect-the-framework)
7. [Flow D: Create the project](#7-flow-d-create-the-project)
8. [Flow E: Project page (edit, delete, reconnect)](#8-flow-e-project-page-edit-delete-reconnect)
9. [Flow F: GitHub webhooks](#9-flow-f-github-webhooks)
10. [What the worker does (and doesn't do yet)](#10-what-the-worker-does-and-doesnt-do-yet)
11. [The deploy spike (M3)](#11-the-deploy-spike-m3)
12. [Data model](#12-data-model)
13. [Security decisions and why](#13-security-decisions-and-why)
14. [How to trace a request yourself](#14-how-to-trace-a-request-yourself)
15. [Where each flow is tested](#15-where-each-flow-is-tested)

---

## 1. The big picture: who talks to whom

```
 ┌────────────┐   same-origin    ┌──────────────────┐   rewrite /api/*   ┌──────────────────────┐
 │  Browser   │ ───────────────► │  Next.js (web)   │ ─────────────────► │   NestJS API (api)   │
 │ (wizard UI)│ ◄─────────────── │  :3000           │ ◄───────────────── │   :4000              │
 └────────────┘                  └──────────────────┘                    └──────────┬───────────┘
       │  full-page redirects                                                      │
       │  (Connect GitHub)                                                          │
       ▼                                                     ┌──────────────────────┼─────────────────────┐
 ┌────────────┐   redirect back to /api/github/setup        │                      │                     │
 │ github.com │ ────────────────────────────────────────►   ▼                      ▼                     ▼
 └────────────┘                                      ┌────────────┐        ┌──────────────┐     ┌──────────────┐
       ▲                                             │ PostgreSQL │        │    Redis     │     │ GitHub REST  │
       │ webhooks (via smee.io in dev)               │ (Prisma)   │        │ cache+queues │     │ api.github.com│
       └──────────────────────────► API /webhooks/github         └──────────────┘     └──────────────┘
                                                                         │ BullMQ "email" queue
                                                                         ▼
                                                                 ┌──────────────────┐
                                                                 │ NestJS worker    │  (emails only, today)
                                                                 └──────────────────┘

 Separately, run by hand from a terminal (not called by the API or worker yet):
 ┌─────────────────────┐   SSH    ┌───────────────────────────────────────────┐
 │ tools/deploy-spike  │ ───────► │ VPS: Docker + Traefik + app containers    │
 └─────────────────────┘          └───────────────────────────────────────────┘
```

### Who calls what

| Caller           | Calls                                     | When                                                                                    |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser          | Next.js pages, and `/api/*` (same origin) | Always. The browser never talks to the API port directly                                |
| Next.js server   | Forwards `/api/*` to the API              | Every API call ([`next.config.ts:24`](../../apps/web/next.config.ts#L24))               |
| API              | PostgreSQL (Prisma), Redis, GitHub REST   | During requests                                                                         |
| API              | Redis queue `email`                       | Sign-up, password reset (M1)                                                            |
| GitHub           | API `/webhooks/github`                    | When the app is installed/uninstalled/suspended, repo access changes, or code is pushed |
| Worker           | SMTP (Mailpit locally)                    | When an email job arrives                                                               |
| **You / Claude** | `tools/deploy-spike` CLI → VPS over SSH   | By hand, to test deploys (M3 spike)                                                     |
| **You / Claude** | `tools/mock-github` (fake GitHub)         | Local demos/UI tests without a real GitHub App                                          |

**Key point:** in this stage, nothing deploys from the dashboard yet. Creating a project only saves settings. The deploy spike is a standalone command-line tool, and its code moves into the worker later in M3 and M4 (see [section 11](#11-the-deploy-spike-m3)).

---

## 2. Where the code lives

| Area                              | Path                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard page                       | [`apps/web/src/app/dashboard/projects/new/`](../../apps/web/src/app/dashboard/projects/new/)                                                                                                   |
| Project page                      | [`apps/web/src/app/dashboard/projects/[id]/`](../../apps/web/src/app/dashboard/projects/%5Bid%5D/)                                                                                             |
| Shared project UI                 | [`apps/web/src/components/projects/`](../../apps/web/src/components/projects/) (repo picker, project form, list, badge)                                                                        |
| Web → API wrappers                | [`apps/web/src/lib/github-api.ts`](../../apps/web/src/lib/github-api.ts), [`projects-api.ts`](../../apps/web/src/lib/projects-api.ts), [`api-client.ts`](../../apps/web/src/lib/api-client.ts) |
| API: GitHub                       | [`apps/api/src/github/`](../../apps/api/src/github/)                                                                                                                                           |
| API: projects                     | [`apps/api/src/projects/`](../../apps/api/src/projects/)                                                                                                                                       |
| GitHub client (shared)            | [`packages/github/src/`](../../packages/github/src/)                                                                                                                                           |
| Framework detection + Dockerfiles | [`packages/adapters/src/`](../../packages/adapters/src/)                                                                                                                                       |
| Request/response schemas (zod)    | [`packages/shared/src/projects/`](../../packages/shared/src/projects/), [`packages/shared/src/github/`](../../packages/shared/src/github/)                                                     |
| Database schema                   | [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma)                                                                                                                   |
| Deploy spike                      | [`tools/deploy-spike/src/`](../../tools/deploy-spike/src/)                                                                                                                                     |
| Mock GitHub                       | [`tools/mock-github/server.mjs`](../../tools/mock-github/server.mjs)                                                                                                                           |

**Why split it like this:**

- **`packages/github`** is separate from the API because the worker needs the same client in M4 to clone private repos.
- **`packages/adapters`** contains no HTTP or GitHub code. It works on a `RepoSnapshot` (a list of files plus a `readFile()` function). That lets the same detection run in two places: over the GitHub API from the dashboard (before anything is cloned), and over SSH on the server (at build time, in the spike).
- **`packages/shared`** zod schemas are imported by both the API (to validate requests) and the web app (to validate forms), so a rule like "project names are lowercase slugs" exists in exactly one place.

---

## 3. What every API request goes through

Before any controller runs, a request passes through these layers, in this order:

| #   | Layer                 | What it does                                                                                      | Code                                                                                            |
| --- | --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Next.js rewrite       | `/api/github/installations` → `http://localhost:4000/github/installations`                        | [`next.config.ts:24`](../../apps/web/next.config.ts#L24)                                        |
| 2   | Express setup         | `trust proxy` (real client IP), 2 MB JSON limit, `helmet`, cookies, CORS                          | [`configure-app.ts:17`](../../apps/api/src/configure-app.ts#L17)                                |
| 3   | Raw body kept         | Exact request bytes saved for webhook signature checks                                            | [`main.ts:14`](../../apps/api/src/main.ts#L14)                                                  |
| 4   | `ThrottlerGuard`      | Rate limits (300/min default; stricter on auth routes)                                            | [`app.module.ts`](../../apps/api/src/app.module.ts)                                             |
| 5   | `OriginGuard`         | Rejects POST/PATCH/DELETE from a foreign `Origin` (CSRF)                                          | [`origin.guard.ts:26`](../../apps/api/src/auth/guards/origin.guard.ts#L26)                      |
| 6   | `AuthGuard`           | Reads the session cookie, loads the user into `req.auth`, rejects if missing (unless `@Public()`) | [`auth.guard.ts:27`](../../apps/api/src/auth/guards/auth.guard.ts#L27)                          |
| 7   | `ZodValidationPipe`   | Validates `@Body()`/`@Query()` against the DTO's zod schema; 400 with per-field errors            | [`app.module.ts:67`](../../apps/api/src/app.module.ts#L67)                                      |
| 8   | Controller → service  | Business logic                                                                                    | —                                                                                               |
| 9   | `AllExceptionsFilter` | Turns any error into `{ statusCode, code, message, fieldErrors?, requestId }`                     | [`all-exceptions.filter.ts:44`](../../apps/api/src/common/filters/all-exceptions.filter.ts#L44) |

On the web side, every call goes through [`apiFetch`](../../apps/web/src/lib/api-client.ts#L44). It turns every kind of failure (network down, error status, non-JSON response) into one `ApiRequestError`, so forms only need one `catch`.

---

## 4. Flow A: Connect GitHub

**User action:** Projects → **New project** → **Connect GitHub**.

### A1. The wizard loads

1. [`NewProjectWizard`](../../apps/web/src/app/dashboard/projects/new/new-project-wizard.tsx#L47) mounts.
2. It calls `GET /api/github/status` ([line 78](../../apps/web/src/app/dashboard/projects/new/new-project-wizard.tsx#L78)), which is answered by [`GithubController.status`](../../apps/api/src/github/github.controller.ts#L47). If the server has no GitHub App credentials, the wizard shows "GitHub isn't set up yet" and stops here.
3. It calls `GET /api/github/installations` ([line 83](../../apps/web/src/app/dashboard/projects/new/new-project-wizard.tsx#L83)) → [`listInstallations`](../../apps/api/src/github/github.controller.ts#L238) → [`GithubInstallationsService.listForUser`](../../apps/api/src/github/github-installations.service.ts#L128). That returns installations where this user is a **member** and which aren't uninstalled.
4. No installations → the **Connect GitHub** card. Otherwise → the repository picker ([Flow B](#5-flow-b-browse-and-search-repositories)).

### A2. Click "Connect GitHub"

The button is a plain link to `/api/github/link` ([`github-api.ts:41`](../../apps/web/src/lib/github-api.ts#L41)). It's a full-page navigation, not a fetch, because the browser has to go to github.com.

```
Browser                 API                          github.com                 GitHub API
  │ GET /api/github/link │                                │                          │
  │─────────────────────►│ link()  github.controller.ts:102
  │                      │ • signed in? else → /login
  │                      │ • set cookie gh_install_state=<random>
  │◄──── 302 ────────────│ → github.com/login/oauth/authorize?client_id&redirect_uri=/api/github/setup&state
  │──────────────────────────────────────────────────────►│ "Authorize Selfship?" (once)
  │◄────────────────────────────────────────── 302 ───────│ → /api/github/setup?code=…&state=…
  │ GET /api/github/setup│                                │                          │
  │─────────────────────►│ setup()  github.controller.ts:144
  │                      │ • state in URL == cookie? (CSRF)
  │                      │ • no installation_id + code → "link" branch
  │                      │ claimAll()  github-installations.service.ts:64
  │                      │──────────── POST /login/oauth/access_token (code → user token) ──►│
  │                      │──────────── GET /user/installations (with user token) ───────────►│
  │                      │ for each installation id:  linkToUser()  :74
  │                      │──────────── GET /app/installations/:id (app JWT) ────────────────►│
  │                      │ • upsert GithubInstallation, upsert GithubInstallationMember
  │                      │ • relinkProjects()  :108   • clear repo cache
  │◄──── 302 ────────────│ → /dashboard/projects/new?github=connected
  │ wizard shows toast "GitHub connected" (new-project-wizard.tsx:58) and loads repos
```

**If the user has no installation yet**, `claimAll` returns 0 and the API continues straight to GitHub's install page ([`redirectToInstall`, line 81](../../apps/api/src/github/github.controller.ts#L81)). After the user clicks **Install** on GitHub, GitHub redirects to `/api/github/setup` again, this time with `installation_id` and `code`. Then the [`claim` branch, line 222](../../apps/api/src/github/github.controller.ts#L222) runs: [`claim()`](../../apps/api/src/github/github-installations.service.ts#L41) checks that the ID is in the user's list from GitHub, then calls the same `linkToUser`.

**"Install on an organization instead"** goes to `/api/github/install` ([line 60](../../apps/api/src/github/github.controller.ts#L60)), which goes straight to GitHub's install page.

### Why it works this way

| Decision                                       | Reason                                                                                                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authorize first, install only if needed**    | GitHub's install URL for an account that already has the app shows a settings page whose Save button stays disabled, and it never redirects back. You hit exactly this. Authorising first avoids it.                                    |
| **Never trust `installation_id` from the URL** | Anyone could edit the URL to claim someone else's installation. We only accept IDs that GitHub lists for the user who authorised (`/user/installations`). See [`installationIdsForUserCode`](../../packages/github/src/client.ts#L415). |
| **State cookie**                               | Stops another site from forcing a "link" on a signed-in user (CSRF). It's mandatory on the link flow; on the install flow it's checked whenever GitHub echoes it back.                                                                  |
| **User token used once, then dropped**         | We only need it to ask "which installations can this person see?". Nothing about the user's GitHub access is stored.                                                                                                                    |
| **Members table**                              | Several people in one GitHub organization can share one installation; each one is verified separately.                                                                                                                                  |
| **`relinkProjects`**                           | GitHub issues a new installation ID on reinstall. Without this, projects would show "GitHub access removed" forever.                                                                                                                    |
| **`/api/github/setup` is `@Public()`**         | If the session expired while the user was on GitHub, they're redirected to login instead of seeing a JSON error.                                                                                                                        |

### How the API authenticates to GitHub

There are three kinds of credentials, all handled in [`packages/github/src/client.ts`](../../packages/github/src/client.ts):

| Credential             | Used for                                                      | Lifetime                                                                                                           | Code                                                                                    |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **App JWT**            | Acting as the app itself (get installation info, mint tokens) | 9 minutes, signed with the private key                                                                             | [`jwt.ts:32`](../../packages/github/src/jwt.ts#L32)                                     |
| **Installation token** | Reading an installation's repositories                        | 1 hour; **cached in memory**, refreshed 5 min early, concurrent requests share one fetch, never stored in DB/Redis | [`getInstallationToken`, client.ts:224](../../packages/github/src/client.ts#L224)       |
| **User token**         | Proving which installations a user can access                 | Used once, discarded                                                                                               | [`installationIdsForUserCode`, client.ts:415](../../packages/github/src/client.ts#L415) |

The client is created once, at API startup, from env vars in [`createGithubClient`](../../apps/api/src/github/github.module.ts#L20). If they're missing it's `null`, and every GitHub endpoint answers "not configured" through [`GithubAppService.client`](../../apps/api/src/github/github-app.service.ts#L32).

---

## 5. Flow B: Browse and search repositories

**User action:** the wizard shows the account dropdown and the repository list; the user types in the search box.

1. [`RepoPicker`](../../apps/web/src/components/projects/repo-picker.tsx#L45) debounces the search input by 300 ms ([line 47](../../apps/web/src/components/projects/repo-picker.tsx#L47)), so typing doesn't fire one request per keystroke.
2. It calls `GET /api/github/installations/:id/repositories?search=&page=&pageSize=10` ([line 69](../../apps/web/src/components/projects/repo-picker.tsx#L69)).
3. The API: [`listRepositories`](../../apps/api/src/github/github.controller.ts#L250)
   - [`getForUser`](../../apps/api/src/github/github-installations.service.ts#L146): is this user a member, and is the installation not removed? (404 otherwise.) Suspended → 409 "unsuspend it on GitHub".
   - [`GithubRepositoriesService.list`](../../apps/api/src/github/github-repositories.service.ts#L38) → [`cachedRepositories`](../../apps/api/src/github/github-repositories.service.ts#L97):
     - **Redis hit** (`github:repos:<installation id>`, 5 minutes) → use it.
     - **Miss** → [`client.listRepositories`](../../packages/github/src/client.ts#L266) fetches every page (100 per page, up to 1 000 repos) with an installation token, sorts by last push, and stores the result in Redis.
   - Filters by search text and slices out the requested page.
4. **Load more** asks for the next page.

**Why fetch everything and search locally?** GitHub has no "search the repositories this installation can access" endpoint. A cached full list makes search instant, and webhooks clear the cache when access changes ([Flow F](#9-flow-f-github-webhooks)). If Redis is down, the list still loads straight from GitHub; the cache is only an optimisation.

---

## 6. Flow C: Select a repository → detect the framework

**User action:** click **Import** on a repository.

1. The wizard stores the repo and renders [`ProjectForm`](../../apps/web/src/components/projects/project-form.tsx#L93) in `create` mode, with name = slugified repo name ([`suggestProjectName`](../../apps/web/src/lib/projects/project-form.ts)), branch = default branch, and root directory = empty.
2. **Branches load:** `GET /api/github/installations/:id/branches?repo=owner/name` ([form line 136](../../apps/web/src/components/projects/project-form.tsx#L136)) → [`listBranches`](../../apps/api/src/github/github.controller.ts#L274) → [`GithubRepositoriesService.branches`](../../apps/api/src/github/github-repositories.service.ts#L65), which puts the default branch first.
3. **Detection runs automatically** ([form lines 175–181](../../apps/web/src/components/projects/project-form.tsx#L175)). It runs on first render, and again whenever the branch changes or the root directory changes (the root directory is debounced 600 ms). A `lastDetected` ref prevents running twice for the same branch and folder.
4. `POST /api/projects/detect` with `{ installationId, repoFullName, branch, rootDirectory }` ([form line 155](../../apps/web/src/components/projects/project-form.tsx#L155)).

### What the API does for detection

[`ProjectsService.detect`](../../apps/api/src/projects/projects.service.ts#L58):

```
detect()
 ├─ getForUser()                         → may this user use this installation?
 ├─ githubRepoSnapshot()                 packages/github/src/snapshot.ts:28
 │    ├─ client.listDirectory(rootDirectory)   GET /repos/o/r/contents/<dir>?ref=<branch>
 │    │    └─ null → RootDirectoryNotFoundError → 400 on the "rootDirectory" field
 │    └─ returns { files: Set<names>, readFile(path) }  ← readFile is lazy + cached,
 │         and skips the API call for names that aren't in the listing
 ├─ detectProject(snapshot)              packages/adapters/src/registry.ts:41
 │    tries adapters IN ORDER, first match wins:
 │    1. dockerfile  – has a Dockerfile?            dockerfile.adapter.ts:22
 │    2. nextjs      – "next" in package.json deps? nextjs.adapter.ts:46
 │    3. spa         – Vite/CRA/Angular/Vue CLI/Astro/Parcel, no server framework? spa.adapter.ts:147
 │    4. node        – package.json with "start" or "main"? node.adapter.ts:23
 │    5. static      – index.html (or public/)?     static.adapter.ts
 └─ no match → adapter: null + fallbackSettings() (registry.ts:58), user picks the type
```

**What each adapter looks at** (all reading through the snapshot, never cloning):

| Helper                         | Logic                                                                                                                                                          | Code                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `readPackageJson`              | Parses package.json leniently: every field is optional and wrongly-typed fields are ignored, so a messy package.json can't crash detection                     | [`package-json.ts:46`](../../packages/adapters/src/node/package-json.ts#L46)   |
| `detectPackageManager`         | `packageManager` field first, then lockfiles (pnpm/bun/yarn/yarn berry/npm)                                                                                    | [`package-json.ts:79`](../../packages/adapters/src/node/package-json.ts#L79)   |
| `detectNodeVersion`            | `.nvmrc` → `.node-version` → `engines.node` → default 22. Only supported versions (18/20/22/24); `>=16` maps to the oldest supported version that satisfies it | [`package-json.ts:113`](../../packages/adapters/src/node/package-json.ts#L113) |
| `installCommand` / `runScript` | Strict install when a lockfile exists (`npm ci`, `--frozen-lockfile`, `--immutable`)                                                                           | [`commands.ts:21`](../../packages/adapters/src/node/commands.ts#L21)           |
| Angular output dir             | Reads `angular.json`; the modern "application" builder outputs to `<outputPath>/browser`                                                                       | [`spa.adapter.ts`](../../packages/adapters/src/adapters/spa.adapter.ts)        |
| Next.js static export          | `output: 'export'` in next.config → treated as an SPA served from `out/`                                                                                       | [`nextjs.adapter.ts`](../../packages/adapters/src/adapters/nextjs.adapter.ts)  |

**Example response** for a Next.js repo with `package-lock.json`:

```json
{
  "adapter": "nextjs",
  "reason": "Found next in package.json",
  "packageManager": "npm",
  "settings": {
    "adapter": "nextjs",
    "installCommand": "npm ci",
    "buildCommand": "npm run build",
    "startCommand": "npm run start",
    "outputDirectory": null,
    "port": 3000,
    "nodeVersion": 22
  }
}
```

5. The form fills these into the fields (`setValue('settings', …)`) and shows "Detected Next.js. Found next in package.json." The user can change anything. Changing **Project type** shows or hides fields according to [`ADAPTER_FIELDS`](../../apps/web/src/lib/projects/project-form.ts#L22) (static sites don't need a start command, and so on).

**Why detect before cloning?** It's fast (a handful of small API calls), needs no server, and lets the user check the settings before anything runs.

---

## 7. Flow D: Create the project

**User action:** click **Create project**.

1. **Client-side validation** with the same zod rules as the API ([`ProjectFormSchema`](../../apps/web/src/lib/projects/project-form.ts#L12) reuses `ProjectNameSchema`, `ProjectSettingsSchema` and others from `packages/shared`).
2. [`cleanSettings`](../../apps/web/src/lib/projects/project-form.ts#L40) clears fields the chosen type doesn't use ([form line 187](../../apps/web/src/components/projects/project-form.tsx#L187)), so switching from Node to Static doesn't save a stale start command.
3. `POST /api/projects` with `{ name, source: { installationId, repoFullName, branch, rootDirectory }, settings }` ([wizard line 242](../../apps/web/src/app/dashboard/projects/new/new-project-wizard.tsx#L242)).

### API

1. **Validation** by `ZodValidationPipe` against [`CreateProjectSchema`](../../packages/shared/src/projects/project.schemas.ts#L158). These rules matter for security, not just tidiness:
   - **Commands must be one line** ([`CommandSchema`](../../packages/shared/src/projects/project.schemas.ts#L30)). They're written into a Dockerfile, where a newline would start a new instruction (injection).
   - **Paths can't contain `..` or be absolute** ([`RelativePathSchema`](../../packages/shared/src/projects/project.schemas.ts#L44)), so a build can't escape its folder.
   - **Repo names can't be `.`/`..`** ([`RepoFullNameSchema`](../../packages/shared/src/projects/project.schemas.ts#L75)). This was a real bug: the integration tests caught `../etc` turning into URL path traversal.
   - **Project names are DNS-safe slugs** ([`ProjectNameSchema`](../../packages/shared/src/projects/project.schemas.ts#L59)), because they'll be used in subdomains and container names.
   - **Type-specific rules:** Node/Next.js need a start command; SPA needs an output folder ([`ProjectSettingsSchema` superRefine](../../packages/shared/src/projects/project.schemas.ts#L93)).
2. [`ProjectsService.create`](../../apps/api/src/projects/projects.service.ts#L104):
   - `getForUser` → may this user use the installation, and is it not suspended?
   - [`verifySource`](../../apps/api/src/projects/projects.service.ts#L238) asks GitHub:
     - Does the repo exist and can the app access it? (`getRepository` → 404 `REPO_NOT_ACCESSIBLE`)
     - Does the branch exist? (`branchExists` → 400 `BRANCH_NOT_FOUND` on the branch field)
     - Does the root folder exist on that branch? (`listDirectory` → 400 `ROOT_DIRECTORY_NOT_FOUND`)
   - `prisma.project.create`. It stores GitHub's **numeric repo ID** (stable across renames) and canonical `owner/name`. Unique `(userId, name)` → 409 `PROJECT_NAME_TAKEN` on the name field.
3. The response is a [`ProjectDto`](../../packages/shared/src/projects/project.schemas.ts), and the wizard redirects to `/dashboard/projects/<id>` ([wizard line 253](../../apps/web/src/app/dashboard/projects/new/new-project-wizard.tsx#L253)).

**How API errors land on the right input:** services throw `{ code, message, fieldErrors: { 'source.branch': [...] } }`. The filter passes `fieldErrors` through, and [`applyApiErrors`](../../apps/web/src/lib/form-errors.ts) maps `source.branch` → the form's `branch` field using `API_FIELD_ALIASES` ([form line 189](../../apps/web/src/components/projects/project-form.tsx#L189)).

**Why verify again on create when detection already worked?** The two requests are separate. Between them the branch could be deleted or access revoked, and a client could also call `POST /projects` directly without detecting first.

---

## 8. Flow E: Project page (edit, delete, reconnect)

[`ProjectDetail`](../../apps/web/src/app/dashboard/projects/%5Bid%5D/project-detail.tsx#L31):

| Action           | Request                                                                                                             | API                                                                           | Notes                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Open page        | `GET /api/projects/:id` ([line 42](../../apps/web/src/app/dashboard/projects/%5Bid%5D/project-detail.tsx#L42))      | [`ProjectsService.get`](../../apps/api/src/projects/projects.service.ts#L156) | Another user's project → **404, not 403**, so IDs can't be probed                                 |
| Save settings    | `PATCH /api/projects/:id` ([line 162](../../apps/web/src/app/dashboard/projects/%5Bid%5D/project-detail.tsx#L162))  | [`update`](../../apps/api/src/projects/projects.service.ts#L172)              | Branch/folder changes are re-verified on GitHub; blocked while GitHub access is removed/suspended |
| Delete           | `DELETE /api/projects/:id` ([line 57](../../apps/web/src/app/dashboard/projects/%5Bid%5D/project-detail.tsx#L57))   | [`remove`](../../apps/api/src/projects/projects.service.ts#L218)              | Only removes the record; nothing is deployed yet                                                  |
| Reconnect GitHub | link to `/api/github/link` ([line 133](../../apps/web/src/app/dashboard/projects/%5Bid%5D/project-detail.tsx#L133)) | [Flow A](#4-flow-a-connect-github)                                            | `relinkProjects` moves the project to the new installation                                        |

The **GitHub state badge** ("GitHub access removed" / "suspended") comes from `connectionState()` in [`project.mapper.ts`](../../apps/api/src/projects/project.mapper.ts), based on the installation's `deletedAt`/`suspendedAt`.

The **Deploy** button is disabled on purpose until the deploy engine lands in M4.

---

## 9. Flow F: GitHub webhooks

GitHub → (in dev: smee.io → `smee-client` on your laptop) → `POST /webhooks/github` → [`GithubWebhooksController.handle`](../../apps/api/src/github/github-webhooks.controller.ts#L62).

1. **Signature first** ([line 77](../../apps/api/src/github/github-webhooks.controller.ts#L77)): an HMAC-SHA256 of the **raw** body with `GITHUB_WEBHOOK_SECRET`, compared in constant time ([`verifyWebhookSignature`](../../packages/github/src/webhooks.ts#L13)). If it's wrong → 401 before anything is parsed.
2. The payload is validated with zod ([`webhooks.ts`](../../packages/github/src/webhooks.ts)), then dispatched by event:

| Event                                | Effect                                                                                         | Code                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `installation.created`               | Upsert the installation (no member yet; members only come from the verified setup flow)        | [`applyInstallationEvent`](../../apps/api/src/github/github-installations.service.ts#L174) |
| `installation.deleted`               | Set `deletedAt` → projects show "GitHub access removed"; forget cached token; clear repo cache | same                                                                                       |
| `installation.suspend` / `unsuspend` | Set/clear `suspendedAt`                                                                        | same                                                                                       |
| `installation_repositories`          | Update all/selected; clear repo cache so the list refreshes                                    | [`applyRepositoriesEvent`](../../apps/api/src/github/github-installations.service.ts#L219) |
| `push`                               | Acknowledged and logged only; **auto-deploy comes in M5**                                      | controller line 106                                                                        |
| anything else / malformed            | 202 "ignored"/"invalid_payload", so GitHub doesn't retry forever                               | —                                                                                          |

The route is `@Public()` (GitHub has no session) and `@SkipThrottle()` (bursts are normal). **Why the raw body?** The signature is computed over the exact bytes GitHub sent; re-serialising the parsed JSON can change them.

---

## 10. What the worker does (and doesn't do yet)

[`apps/worker/src/`](../../apps/worker/src/) is a NestJS app without an HTTP server. It consumes BullMQ jobs from Redis:

| Queue    | Job    | Produced by                                                                               | Consumer                                                                                                                    |
| -------- | ------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `email`  | `send` | API ([`MailService`](../../apps/api/src/mail/mail.service.ts)) on sign-up, password reset | [`email.processor.ts`](../../apps/worker/src/email/email.processor.ts): validates payload, renders template, sends via SMTP |
| `system` | `ping` | API dev endpoint `POST /diagnostics/ping-worker`                                          | [`system.processor.ts`](../../apps/worker/src/system/system.processor.ts)                                                   |

**Nothing in the GitHub/projects flows touches the worker yet.** Those are quick request/response calls, so the API handles them directly. The worker takes over for anything long-running, starting in M3:

```
 (M3/M4, planned)
 Dashboard "Deploy" ─► API: create Deployment row, enqueue "deploy" job ─► Redis
                                                                            │
                         live logs over WebSocket ◄── Redis pub/sub ◄── Worker
                                                                            │ SSH (spike code)
                                                                            ▼
                                                                          VPS
```

---

## 11. The deploy spike (M3)

### What it is and who runs it

[`tools/deploy-spike`](../../tools/deploy-spike/) is a **command-line tool run by hand** (by you or me) from a terminal. It's not called by the API, the worker or the UI. Its job was to prove that the deploy approach works on real servers and to measure it ([results](../spike-results.md)). Its modules are written to move into the worker almost unchanged.

```bash
pnpm --filter @selfship/deploy-spike spike check     --host 13.50.208.142
pnpm --filter @selfship/deploy-spike spike bootstrap --host 13.50.208.142
pnpm --filter @selfship/deploy-spike spike deploy    --host 13.50.208.142 \
     --repo https://github.com/vercel/next.js --ref canary --root-dir examples/hello-world \
     --domain next.spike.selfship.dev --app next-hello --probe
```

It runs TypeScript directly with Node's built-in type stripping (`--experimental-strip-types`), so there's no build step.

### Module map

| File                                                                        | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                  | Becomes in the product             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`cli.ts`](../../tools/deploy-spike/src/cli.ts)                             | Parses arguments, connects, runs the command, prints timings/memory, `--probe` downtime test ([`startProbe`, line 55](../../tools/deploy-spike/src/cli.ts#L55); [`main`, line 99](../../tools/deploy-spike/src/cli.ts#L99))                                                                                                                                                                                                                     | Worker job handlers                |
| [`ssh.ts`](../../tools/deploy-spike/src/ssh.ts)                             | [`SshConnection`](../../tools/deploy-spike/src/ssh.ts#L83): connect with **host key pinning** ([`hostVerifier`, line 113](../../tools/deploy-spike/src/ssh.ts#L113)), `exec` with live output and timeouts, `sudo` wrapper ([line 139](../../tools/deploy-spike/src/ssh.ts#L139)), `writeFile` via stdin ([line 195](../../tools/deploy-spike/src/ssh.ts#L195)); [`sh()`](../../tools/deploy-spike/src/ssh.ts#L65) quotes every value           | Worker SSH service                 |
| [`preflight.ts`](../../tools/deploy-spike/src/preflight.ts#L42)             | One script prints `KEY=VALUE` facts (OS, arch, RAM, swap, disk, sudo, Docker, ports 80/443) and flags blocking problems                                                                                                                                                                                                                                                                                                                         | Pre-flight job (add-server wizard) |
| [`bootstrap.sh`](../../tools/deploy-spike/src/bootstrap.sh)                 | Idempotent server setup, 4 sections: Docker ≥ 23 ([line 18](../../tools/deploy-spike/src/bootstrap.sh#L18)), swap if RAM < 2 GB ([line 32](../../tools/deploy-spike/src/bootstrap.sh#L32)), ufw allowing the SSH port first ([line 47](../../tools/deploy-spike/src/bootstrap.sh#L47)), `selfship` network + Traefik with Let's Encrypt, recreated only when its config hash changes ([line 56](../../tools/deploy-spike/src/bootstrap.sh#L56)) | Bootstrap job                      |
| [`remote-snapshot.ts`](../../tools/deploy-spike/src/remote-snapshot.ts#L12) | A `RepoSnapshot` over SSH (`ls`/`cat` on the clone), so **the same adapters** detect at build time                                                                                                                                                                                                                                                                                                                                              | Same                               |
| [`deploy.ts`](../../tools/deploy-spike/src/deploy.ts#L49)                   | The deploy steps (below)                                                                                                                                                                                                                                                                                                                                                                                                                        | Deploy job                         |
| [`memory-sampler.ts`](../../tools/deploy-spike/src/memory-sampler.ts#L18)   | Samples `/proc/meminfo` every second during a build for peak RAM/swap                                                                                                                                                                                                                                                                                                                                                                           | Build metrics                      |

### `deploy()` step by step

| Step            | What happens                                                                                                                                                                                                                    | Code                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1. Clone        | `git clone --depth 1`; with a root directory, a **sparse** clone fetches only that folder (3–4 s even for vercel/next.js)                                                                                                       | [line 60](../../tools/deploy-spike/src/deploy.ts#L60)   |
| 2. Detect       | `detectProject(remoteSnapshot(...))`: the same function as the dashboard's detection                                                                                                                                            | [line 74](../../tools/deploy-spike/src/deploy.ts#L74)   |
| 3. Build files  | `getAdapter(type).buildFiles(...)` returns a Dockerfile + `.dockerignore`, written next to the code (repos with their own Dockerfile are left alone)                                                                            | [line 80](../../tools/deploy-spike/src/deploy.ts#L80)   |
| 4. Build        | `docker build` with live output                                                                                                                                                                                                 | [line 91](../../tools/deploy-spike/src/deploy.ts#L91)   |
| 5. Start        | `docker run` on the `selfship` network with **Traefik labels** and a **Docker health check**, next to the old version                                                                                                           | [line 104](../../tools/deploy-spike/src/deploy.ts#L104) |
| 6. Wait healthy | Docker reports `healthy` **and** an HTTP request to the container returns < 500 ([`waitHealthy`, line 193](../../tools/deploy-spike/src/deploy.ts#L193)). If never healthy → remove the new container and keep the old one live | [line 144](../../tools/deploy-spike/src/deploy.ts#L144) |
| 7. Switch       | Stop and remove previous versions                                                                                                                                                                                               | [line 159](../../tools/deploy-spike/src/deploy.ts#L159) |
| 8. Housekeeping | Keep the last 3 images and builds (for rollback)                                                                                                                                                                                | [line 176](../../tools/deploy-spike/src/deploy.ts#L176) |

**The generated Dockerfile** for the Next.js example above (from [`nextjs.adapter.ts`](../../packages/adapters/src/adapters/nextjs.adapter.ts) + [`nodeBuildStage`](../../packages/adapters/src/dockerfile.ts#L108)):

```dockerfile
# Generated by Selfship (nextjs adapter).
FROM node:22-alpine AS build
WORKDIR /app
ENV CI=true NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json* npm-shrinkwrap.json* .npmrc* ./
RUN npm ci                      # dependencies cached until a manifest changes
COPY . .
ARG NEXT_PUBLIC_API_URL         # build-time env vars become build args (M4)
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
USER node                       # never run apps as root
EXPOSE 3000
CMD ["sh", "-c", "npm run start"]   # JSON-escaped, so quotes in commands are safe
```

Every value is re-checked while rendering ([`safeCommand`, `safePath`, `buildArgs`, `safePort`](../../packages/adapters/src/dockerfile.ts#L27)). That's a second line of defence after the API's validation.

### How Traefik routes a request

```
https://next.spike.selfship.dev
   │ DNS (Cloudflare, grey cloud) → 13.50.208.142
   ▼
Traefik (:443) ── matches label  traefik.http.routers.next-hello.rule=Host(`next.spike.selfship.dev`)
   │              TLS: certresolver "le" → Let's Encrypt (HTTP-01 challenge on :80)
   ▼
service next-hello → every healthy container labelled with it → container:3000
```

- HTTP on :80 redirects to HTTPS, except Let's Encrypt's challenge path.
- **Zero downtime:** old and new versions carry the same router/service labels, so during the overlap Traefik balances across both. Traefik ignores a container until its Docker health check passes, which fixed the 502 the spike found ([details](../spike-results.md#findings)). Then the old container is removed.

### Bootstrap: why each part

| Part                      | Why                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Docker ≥ 23               | Generated nginx configs use a BuildKit heredoc (decision #43)                                          |
| Swap when RAM < 2 GB      | A Next.js build on 1 GB used 336 MB of swap; without swap it would be killed for running out of memory |
| ufw: SSH port **first**   | Enabling the firewall before allowing SSH would lock us out                                            |
| Traefik config hash       | Re-running bootstrap doesn't restart Traefik (no downtime) unless its settings changed                 |
| `acme.json` with mode 600 | Holds the certificates' private keys                                                                   |

---

## 12. Data model

From [`schema.prisma`](../../packages/db/prisma/schema.prisma):

```
User ──< GithubInstallationMember >── GithubInstallation ──< Project >── User (owner)
  │                                     githubInstallationId (GitHub's number, unique)
  │                                     accountLogin, accountType, repositorySelection
  │                                     suspendedAt, deletedAt   ← drive the project's GitHub state
  └──< Session, VerificationToken, OAuthAccount   (M1)

Project: name (unique per user), repoId (GitHub number), repoFullName, branch, rootDirectory,
         adapter, installCommand, buildCommand, startCommand, outputDirectory, port, nodeVersion
```

| Model                      | Line                                               | Note                                                                              |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GithubInstallation`       | [105](../../packages/db/prisma/schema.prisma#L105) | Soft-deleted on uninstall, so projects can explain what happened                  |
| `GithubInstallationMember` | [129](../../packages/db/prisma/schema.prisma#L129) | Who may use an installation (verified via GitHub)                                 |
| `Adapter` enum             | [144](../../packages/db/prisma/schema.prisma#L144) | Same names as the adapters package                                                |
| `Project`                  | [155](../../packages/db/prisma/schema.prisma#L155) | `onDelete: Restrict` on the installation (installations are soft-deleted instead) |

GitHub IDs are stored as `BigInt` and converted with `toGithubId()` ([`github.constants.ts`](../../apps/api/src/github/github.constants.ts)). They're far below 2^53, so the conversion is exact.

---

## 13. Security decisions and why

| Risk                                                           | Defence                                                                          | Where                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claiming someone else's GitHub installation by editing the URL | Accept only IDs that GitHub lists for the authorising user                       | [`claim`](../../apps/api/src/github/github-installations.service.ts#L41), [`claimAll`](../../apps/api/src/github/github-installations.service.ts#L64)    |
| CSRF on the GitHub round trip                                  | Random state in an httpOnly cookie, compared in constant time                    | [`github.controller.ts`](../../apps/api/src/github/github.controller.ts)                                                                                 |
| Seeing/editing other users' projects or installations          | Every query filters by `userId`/membership; 404 for others                       | [`projects.service.ts`](../../apps/api/src/projects/projects.service.ts), [`getForUser`](../../apps/api/src/github/github-installations.service.ts#L146) |
| Leaked GitHub tokens                                           | Installation tokens in memory only; user token used once; app key only in `.env` | [`client.ts`](../../packages/github/src/client.ts)                                                                                                       |
| Forged webhooks                                                | HMAC signature over the raw body                                                 | [`webhooks.ts:13`](../../packages/github/src/webhooks.ts#L13)                                                                                            |
| Dockerfile injection via build settings                        | Single-line commands, safe paths, validated again while rendering                | [`project.schemas.ts`](../../packages/shared/src/projects/project.schemas.ts), [`dockerfile.ts`](../../packages/adapters/src/dockerfile.ts)              |
| URL path traversal into GitHub's API                           | Repo names/paths reject `.`/`..`; the client refuses them too                    | [`client.ts:520`](../../packages/github/src/client.ts#L520)                                                                                              |
| Untrusted GitHub/package.json data crashing us                 | All external JSON parsed with zod; lenient package.json parsing                  | throughout                                                                                                                                               |
| Server impersonation (SSH)                                     | Host key fingerprint pinning                                                     | [`ssh.ts:113`](../../tools/deploy-spike/src/ssh.ts#L113)                                                                                                 |
| Shell injection in SSH commands                                | Every value goes through `sh()` quoting                                          | [`ssh.ts:65`](../../tools/deploy-spike/src/ssh.ts#L65)                                                                                                   |
| Apps running as root                                           | Generated images use `USER node`; nginx images serve static files only           | adapters                                                                                                                                                 |

---

## 14. How to trace a request yourself

1. **Run everything:** `pnpm infra:up && pnpm dev` (plus `npx smee-client …` for webhooks).
2. **Follow one request:** every API response includes a `requestId` in error bodies, and the API log line for that request has the same `req.id`. Set `LOG_LEVEL=debug` in `.env` for more detail.
3. **Watch the GitHub calls:** with `pnpm mock:github` (and `source .dev/mock-github.env` before `pnpm dev`), the mock prints every GitHub request it receives (`[mock-github] GET /installation/repositories…`). It's the easiest way to see exactly which GitHub calls a UI action triggers.
4. **Inspect data:** `pnpm db:studio` opens Prisma Studio (tables `github_installations`, `github_installation_members`, `projects`).
5. **Inspect the cache:** `docker exec -it selfship-dev-redis-1 redis-cli KEYS 'github:repos:*'` and `TTL <key>`.
6. **Call the API directly:** sign in through the UI, copy the `sid` cookie from the browser devtools, then for example:
   ```bash
   curl -s -b "sid=<cookie>" localhost:4000/github/installations | jq
   curl -s -b "sid=<cookie>" -H 'Content-Type: application/json' -X POST localhost:4000/projects/detect \
     -d '{"installationId":"<id>","repoFullName":"owner/repo","branch":"main","rootDirectory":""}' | jq
   ```
7. **Servers:** `ssh ubuntu@13.50.208.142`, then `sudo docker ps`, `sudo docker logs selfship-traefik`, `sudo docker inspect <container>` (labels, health).

---

## 15. Where each flow is tested

| Flow                                                                                                               | Tests                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schemas (names, paths, commands, branches, repo names)                                                             | [`project.schemas.spec.ts`](../../packages/shared/src/projects/project.schemas.spec.ts)                                                                                                                                      |
| Detection per framework + Dockerfile output + injection guards                                                     | [`adapters.spec.ts`](../../packages/adapters/src/adapters.spec.ts), [`dockerfile.spec.ts`](../../packages/adapters/src/dockerfile.spec.ts), [`fixtures.spec-helper.ts`](../../packages/adapters/src/fixtures.spec-helper.ts) |
| GitHub client: JWT, token cache, pagination, 401 retry, timeouts, signatures, path safety                          | [`client.spec.ts`](../../packages/github/src/client.spec.ts)                                                                                                                                                                 |
| Connect/link/claim, ownership, repos, detection, projects CRUD, webhooks, reinstall (real DB + Redis, fake GitHub) | [`github-projects.e2e-spec.ts`](../../apps/api/test/github-projects.e2e-spec.ts) with [`fake-github.ts`](../../apps/api/test/fake-github.ts)                                                                                 |
| Repo cache fallback when Redis is down; error mapping                                                              | [`github-repositories.service.spec.ts`](../../apps/api/src/github/github-repositories.service.spec.ts), [`github-app.service.spec.ts`](../../apps/api/src/github/github-app.service.spec.ts)                                 |
| Web helpers (form cleaning, name suggestion, API client failures)                                                  | [`project-form.test.ts`](../../apps/web/src/lib/projects/project-form.test.ts), [`api-client.test.ts`](../../apps/web/src/lib/api-client.test.ts)                                                                            |
| Real servers (manual)                                                                                              | The deploy spike runs in [spike-results.md](../spike-results.md)                                                                                                                                                             |

Run them: `pnpm test` (unit), `pnpm --filter @selfship/api test:e2e` (integration, needs `pnpm infra:up`).

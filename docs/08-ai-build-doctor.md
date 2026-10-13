# 08 — Build Doctor (AI build-error assistant)

When a deployment fails, users get a clear diagnosis, not a wall of logs: **what broke, why, and exactly how to fix it.** For platform/server-side problems, we fix them automatically where it's safe.

Ships in **Phase 1 · M6** (v1, single call). Agentic v2 in **Phase 2 · M14**.

## Flow

```
Deployment failed at stage X
        │
        ▼
1. Rule engine (free, instant)  ── match? ──► show rule explanation (+ optional AI enrichment)
        │ no match
        ▼
2. Fingerprint error  ── cached diagnosis? ──► reuse it
        │ no
        ▼
3. Build context (redacted)  ──►  Claude (structured output)  ──►  Diagnosis
        │
        ▼
4. category == platform/server_resources AND action in allowlist?
        ├─ yes, safe action  ──► auto-apply once, retry deployment, tell user what we did
        └─ otherwise         ──► show fix steps / suggested patch / "Apply fix" button
```

## What we send (context)

| Included | Excluded |
|----------|----------|
| Failed stage + exit code | **Env var values** (keys only) |
| Last ~300 log lines, redacted | SSH keys, tokens, anything matching secret patterns |
| Adapter name + generated Dockerfile | Full source code |
| `package.json` (or `composer.json`, etc.) | Files not relevant to the error |
| File tree, depth 2 | |
| Server specs (RAM, disk, arch) | |

Redaction runs twice: known secret values are masked, and regexes catch keys/tokens (AWS keys, GitHub tokens, private key blocks, JWTs, connection strings).

## Diagnosis schema

Defined once with zod in `packages/shared`, and used both as the Claude **structured-output format** and as the API response type:

```ts
export const DiagnosisSchema = z.object({
  category: z.enum([
    'user_code',          // syntax/type errors, failing imports
    'dependency',         // install failures, version conflicts, missing lockfile
    'configuration',      // wrong build/start cmd, port, root dir, missing env var
    'server_resources',   // OOM, disk full
    'platform',           // our bug / infra issue (Docker, Traefik, SSH)
    'network',            // registry/DNS timeouts
    'unknown',
  ]),
  summary: z.string(),            // one sentence, plain language
  rootCause: z.string(),          // detailed explanation
  evidence: z.array(z.string()),  // the log lines that prove it
  fixSteps: z.array(z.string()),  // ordered, actionable steps
  suggestedPatch: z
    .object({ filePath: z.string(), diff: z.string() })
    .nullable(),
  remediation: z
    .object({
      action: z.enum(['add_swap', 'prune_docker', 'retry', 'set_port', 'set_node_version', 'set_build_command', 'set_start_command']),
      params: z.record(z.string()),
    })
    .nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});
```

## Safety rules

- **The model never runs commands.** It can only *propose* an action from a fixed enum. Our code validates the params and executes a pre-written, tested implementation
- **Auto-apply** only for `add_swap`, `prune_docker`, `retry`, and only when the category is `server_resources`/`platform`. Max **one** automatic retry per deployment
- Config actions (`set_port`, `set_build_command` ...) need the user to click **Apply fix**
- Code patches are only shown as a diff (v1). In v2 they can be opened as a PR on a new branch, opt-in only
- Log lines are untrusted input (a malicious repo could print "ignore your instructions..."). The system prompt treats logs as data, and the enum-only action surface limits damage

## Claude API usage

- SDK: `@anthropic-ai/sdk`, in `apps/worker` (`BuildDoctorService`)
- Model: **`claude-opus-5-5`** (Anthropic's current default). Configurable through `BUILD_DOCTOR_MODEL` env so self-hosters can choose
- Structured output: `client.messages.parse()` with `output_config.format: zodOutputFormat(DiagnosisSchema)`, so the response is validated against the schema
- `stop_reason` checked before reading content (handles `refusal` / `max_tokens`)
- Server-side **fallbacks** enabled (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) so a refusal falls back to another model automatically
- Stable system prompt first, with **prompt caching**, so repeated calls are cheaper
- v2 (agentic): the SDK **tool runner** with read-only tools (`read_repo_file`, `list_dir`, `get_last_successful_log`)

### Cost estimate (v1)

Roughly 10–20K input tokens + ~1.5K output tokens per diagnosis. At Opus 5.5 pricing ($4 / $20 per million tokens) that's **about $0.06–$0.11 per failed build**, less with caching and fingerprint reuse. Controls:
- Only runs on failure and only when rules didn't match
- Fingerprint cache (normalized error lines + adapter + lockfile hash)
- Daily quota per plan (e.g. Free: 3/day, paid: 50/day)
- Log token usage per diagnosis so we can watch the real cost

## API key

The product needs its **own Anthropic API key** from the Claude Console, set as `ANTHROPIC_API_KEY` on the worker. A Claude Code / Claude.ai subscription login is for your personal use and can't be built into the product. In self-hosted installs, the operator brings their own key. If none is set, Build Doctor is turned off and users see only the rule-based explanations.

## Privacy

- Disclose in the privacy policy and in the UI that redacted build logs and config files are sent to Anthropic for analysis
- Per-project toggle: "Use AI to diagnose failed builds" (on by default for SaaS, off by default for self-host)

## Measuring quality

- 👍/👎 + optional comment on every diagnosis
- Keep a labelled set of real failures (redacted) as an eval set, and re-run it when we change the prompt or model

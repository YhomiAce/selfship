# Set up the Selfship GitHub App

Selfship reads repositories through a **GitHub App**. Users install it on their account or organization and choose which repositories it can see. This guide registers the app for **local development**. Production is the same with your real domain.

> Just want to try the flow? `pnpm mock:github` runs a local fake GitHub. See [Try it without GitHub](#try-it-without-github-mock).

## 1. Create the app

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
(direct link: https://github.com/settings/apps/new; for an organization: `https://github.com/organizations/<org>/settings/apps/new`)

| Field                                                      | Value                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub App name                                            | `Selfship Local (<your-name>)`: must be unique on GitHub                                              |
| Homepage URL                                               | `http://localhost:3000`                                                                               |
| **Callback URL** (1)                                       | `http://localhost:3000/api/github/setup` (connecting accounts)                                        |
| **Callback URL** (2), click "Add Callback URL"             | `http://localhost:3000/api/auth/github/callback` (only if you use this app for "Sign in with GitHub") |
| Expire user authorization tokens                           | ✅ (default)                                                                                          |
| **Request user authorization (OAuth) during installation** | ✅ **Required.** It's how Selfship verifies who installed the app                                     |
| Enable Device Flow                                         | ☐                                                                                                     |
| Setup URL                                                  | Leave empty (disabled when the option above is on)                                                    |
| **Redirect on update**                                     | ✅ So changing repository access returns to Selfship                                                  |
| Webhook → Active                                           | ✅                                                                                                    |
| Webhook URL                                                | Your smee.io URL (see step 4) or `https://<your-domain>/api/webhooks/github`                          |
| Webhook secret                                             | A random string: `openssl rand -hex 32`. Keep it for `.env`                                           |

**Permissions → Repository permissions:**

| Permission | Access                |
| ---------- | --------------------- |
| Contents   | **Read-only**         |
| Metadata   | Read-only (always on) |

**Account permissions:** none for repository access. If you also use this app for **"Sign in with GitHub"** (`GITHUB_CLIENT_ID` = the app's client ID), set **Email addresses → Read-only**: sign-in needs the verified email.

**Subscribe to events:** ✅ **Push**. Installation events are always sent to GitHub Apps; you don't select them.

**Where can this GitHub App be installed?**: _Only on this account_ keeps it private: **only your own GitHub account** can install or sign in with it, and every other account gets a 404. Choose _Any account_ (or later: app settings → **Advanced → Make public**) as soon as anyone else needs to try it, including your own second test account.

Click **Create GitHub App**.

## 2. Collect the credentials

On the app's settings page:

1. **App ID**: shown under "About"
2. **Client ID**: shown under "About" (starts with `Iv`)
3. **Client secret**: click **Generate a new client secret** and copy it now (shown once)
4. **Slug**: the last part of the public URL `https://github.com/apps/<slug>`
5. **Private key**: scroll to "Private keys", click **Generate a private key**, and a `.pem` file downloads

## 3. Configure Selfship

Add to the root `.env`:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=selfship-local-ada
GITHUB_APP_CLIENT_ID=Iv23li...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_WEBHOOK_SECRET=<the random string from step 1>
GITHUB_APP_PRIVATE_KEY="<single line, see below>"
```

The private key must be on one line with `\n` between lines. Convert the downloaded file with:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' ~/Downloads/selfship-local-ada.*.private-key.pem
```

Paste the output between the quotes. **Never commit this key.** `.env` is gitignored.

All six values are required together: the API refuses to start if only some are set, and tells you which are missing. Restart `pnpm dev` afterwards.

## 4. Receive webhooks locally

GitHub can't reach `localhost`, so use a relay:

1. Open https://smee.io and click **Start a new channel**. Use that URL as the app's **Webhook URL** (step 1).
2. Run the relay while developing:

   ```bash
   npx smee-client --url https://smee.io/<your-channel> --target http://localhost:4000/webhooks/github
   ```

Webhooks tell Selfship when the app is uninstalled or suspended, or when repository access changes. Without them, those changes show up only after GitHub returns an error.

## 5. Try it

1. `pnpm dev`, sign in, open **Projects → New project**
2. Click **Connect GitHub**, pick your account and a few repositories, then **Install**
3. You're sent back to Selfship. Pick a repository and check the detected settings
4. **Uninstall** the app on GitHub (Settings → Applications → Installed GitHub Apps) and the project shows "GitHub access removed". **Reconnect GitHub** re-links it.

## Troubleshooting

| Symptom                                                                              | Fix                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toast: _"…must have Request user authorization (OAuth) during installation enabled"_ | Enable that checkbox in the app settings (step 1)                                                                                                                                                                 |
| Toast: _"GitHub didn't confirm you have access to that installation"_                | You installed it with a different GitHub user than the one that authorised. Sign in to GitHub as the account owner and try again                                                                                  |
| _"GitHub isn't set up yet"_ in the wizard                                            | One or more `GITHUB_APP_*` values are missing; check the API startup log                                                                                                                                          |
| API fails to start: _"GITHUB_APP_PRIVATE_KEY could not be parsed"_                   | Re-run the `awk` command and paste the whole output, including the BEGIN/END lines                                                                                                                                |
| Webhook deliveries show **401** in GitHub's "Recent Deliveries"                      | `GITHUB_WEBHOOK_SECRET` doesn't match the secret in the app settings                                                                                                                                              |
| Webhook deliveries show **200** on GitHub but Selfship doesn't react                 | smee.io accepted them but the relay isn't running: start `npx smee-client …` (step 4)                                                                                                                             |
| GitHub says **"The redirect_uri is not associated with this application"**           | Add the missing Callback URL (step 1): `/api/github/setup` for connecting, `/api/auth/github/callback` for sign-in                                                                                                |
| Another GitHub account gets a **404** on the authorize or install page               | The app is private ("Only on this account"). App settings → **Advanced → Make public**                                                                                                                            |
| After installing, GitHub **doesn't send you back** to Selfship                       | Tick **Request user authorization (OAuth) during installation** and **Redirect on update**. Then use **"Already installed the app? Link it"** in the wizard: it links existing installations without reinstalling |
| "Sign in with GitHub" fails after authorising                                        | If sign-in uses this app, give it **Email addresses: Read-only** (account permissions) and accept the new permission on your installation                                                                         |
| A repository is missing from the list                                                | Click **Change repository access on GitHub** in the wizard and add it. The list refreshes within 5 minutes (instantly with webhooks)                                                                              |

## Try it without GitHub (mock)

For a quick local demo, without registering an app:

```bash
pnpm mock:github                                     # terminal 1: fake GitHub on :4010
set -a; source .dev/mock-github.env; set +a; pnpm dev   # terminal 2
```

The mock has five sample repositories (Next.js, Vite, static HTML, a monorepo, a Dockerfile project). Its "manage installation" page (the **Change repository access** link) has buttons that send real, signed **uninstall/suspend** webhooks to your API. Don't use it in production: it accepts any credentials.

## What Selfship can and can't do with this app

- ✅ Read the code of repositories you selected (to detect the framework now, and to build and deploy later)
- ✅ Receive push events (auto-deploy, coming in a later milestone)
- ❌ Write to your repositories, read issues/PRs, or access repositories you didn't select
- Installation tokens are kept in memory for under an hour and never stored. The user token from the install step is used once to verify ownership, then discarded.

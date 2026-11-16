# Set up the dev environment (dev.selfship.dev), step by step

Follow this once to get automatic deployments working. Afterwards, every merge to `main` deploys to https://dev.selfship.dev by itself.

**Time:** about 45 minutes, most of it waiting.
**Cost once it's running:** about $13.60/month from your AWS credits (about $2/month while stopped).

Do the parts **in order**. Each step says what to do, and **✅ how to check it worked** before moving on.

```
Part 1  Cloudflare token        (so Terraform can create dev.selfship.dev)
Part 2  Create the server       (Terraform → AWS)
Part 3  The server's settings   (dev.env → server)
Part 4  Connect GitHub          (deploy key → GitHub "dev" environment)
Part 5  Merge the pipeline      (first automatic deploy)
Part 6  Check it                (open the site, make images public)
Part 7  GitHub App for dev      (optional, to connect repositories)
```

All commands run in a terminal, in this folder unless a step says otherwise:

```bash
cd ~/Documents/Projects/infra/aws/platform-dev
```

---

## Part 1: Cloudflare token and zone ID

Terraform needs permission to create the DNS record `dev.selfship.dev`. The token you already have only covers `selfship.app`, so make a new one.

### 1.1 Create the token

1. Go to https://dash.cloudflare.com/profile/api-tokens and click **Create Token**.
2. Next to **Edit zone DNS**, click **Use template**.
3. Under **Zone Resources**, choose **Include → Specific zone → selfship.dev**.
4. Click **Continue to summary**, then **Create Token**.
5. **Copy the token now.** Cloudflare shows it only once. Keep it in your password manager; don't save it in the repo.

### 1.2 Find the zone ID

1. In the Cloudflare dashboard, click the **selfship.dev** domain.
2. On its **Overview** page, scroll down the **right-hand column** to the **API** section.
3. Copy the **Zone ID**, a 32-character code.

### 1.3 Give them to Terraform

```bash
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` (it's gitignored, so it never gets committed) and paste the zone ID:

```hcl
cloudflare_zone_id = "paste-the-zone-id-here"
admin_cidrs        = ["102.220.173.0/24"]
```

`admin_cidrs` is the range your home internet comes from; only it can SSH in as admin. To check yours, run `curl -s https://checkip.amazonaws.com`. If the result doesn't start with `102.220.173.`, put your IP with `/32` on the end instead.

Then, **in the same terminal you'll use for Part 2**, set the token. It stays in this terminal only and is never written to a file:

```bash
export CLOUDFLARE_API_TOKEN=paste-the-token-here
```

✅ **Check:** this should print `success: True`:

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify | grep -o '"success":true' && echo "success: True"
```

---

## Part 2: Create the server

```bash
make init
make up
```

`make up` shows what it will create (11 items: the server, its firewall rules, the DNS record, the SSH keys) and asks **"Do you want to perform these actions?"**. Type `yes`. It takes about a minute.

Now wait for the server to finish installing Docker and its settings (about 3 minutes):

```bash
make ready
```

Repeat it every minute until it prints **`ready`**. The first try or two may say `still installing (cloud-init)`, or fail to connect while the server boots; that's normal.

✅ **Check:**

- `make ready` prints `ready`.
- `make ssh` opens a shell on the server. Type `exit` to leave.

> If `make ready` still fails after 5 minutes, see [Troubleshooting](#troubleshooting).

---

## Part 3: The server's settings (dev.env)

The platform needs a few secrets: a database password and an encryption key. Generate them on your machine and send them to the server:

```bash
make env-init
```

This creates `dev.env` (gitignored, readable only by you) with a random `POSTGRES_PASSWORD` and `ENCRYPTION_KEY` already filled in.

**Do this now:** copy the `ENCRYPTION_KEY=...` line into your password manager. If it's ever lost, the SSH keys and env vars users saved in Selfship can't be decrypted.

Leave everything else in `dev.env` empty for now. SMTP and the GitHub App are optional, and the dashboard starts without them. Send it to the server:

```bash
make env-push
```

✅ **Check:** it prints `Uploaded.` and then `Nothing deployed yet: push to main …`. That's expected; nothing is deployed until Part 5.

---

## Part 4: Connect GitHub to the server

This puts the deploy key and the server's address into a GitHub **environment** called `dev`, which the deploy workflow uses. It also limits that environment to the `main` branch. You need `gh` logged in (you are already: `gh auth status`).

```bash
make github-env
```

✅ **Check:** it ends with `GitHub environment 'dev' is set up for YhomiAce/selfship.` On GitHub, **YhomiAce/selfship → Settings → Environments → dev** shows:

- 1 secret: `DEPLOY_SSH_KEY`
- 3 variables: `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`, `APP_URL`
- deployment branches: `main`

---

## Part 5: Merge the pipeline into main (the first automatic deploy)

The pipeline lives on the branch `feat/cicd-dev` (2 commits on top of `main`). Push it and open a pull request, from the **repo root**:

```bash
cd ~/Documents/Projects
git push -u origin feat/cicd-dev
gh pr create --base main --head feat/cicd-dev --title "CI/CD: deploy main to dev.selfship.dev" --body "See docs/guides/dev-environment-setup.md."
```

Wait for the **CI** check on the PR to go green, then merge it on GitHub (or `gh pr merge --merge`). **This merge is the first deploy.**

✅ **Check:** on GitHub, open **Actions → Deploy dev**. You'll see three jobs:

| Job      | Takes                                | What it does                                                                  |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `checks` | ≈ 5 min                              | lint, typecheck, tests (the same as on PRs)                                   |
| `images` | ≈ 8 min the first time, faster later | builds the 4 images and pushes them to ghcr.io                                |
| `deploy` | ≈ 2 min                              | tells the server to deploy, then checks `https://dev.selfship.dev/api/health` |

All three should end with a green tick.

> **If `deploy` fails with `denied` / `unauthorized` while pulling images**, do Part 6.2, then re-run the job: open the run → **Re-run failed jobs**.

---

## Part 6: Check it

### 6.1 Open the site

Go to https://dev.selfship.dev and sign up. It's an empty, fresh database.

From your terminal (in `infra/aws/platform-dev`):

```bash
make status    # shows the deployed commit and all containers "Up … (healthy)"
```

### 6.2 Make the images public (once)

GitHub sometimes creates new container images as **private**, even for a public repo. The server can't pull private images.

1. Go to https://github.com/YhomiAce?tab=packages.
2. For each of **selfship-api**, **selfship-worker**, **selfship-web** and **selfship-migrate**: open it → **Package settings** (bottom right) → **Danger Zone → Change visibility → Public**.

✅ **Check:** all four show **Public** on the packages page.

---

## Part 7: GitHub App for dev (optional, when you want to connect repos)

The dev site needs its **own** GitHub App, because an app has a single webhook URL. Follow [github-app-setup.md](github-app-setup.md) with these values:

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| GitHub App name | `Selfship Dev`                                 |
| Homepage URL    | `https://dev.selfship.dev`                     |
| Callback URL    | `https://dev.selfship.dev/api/github/setup`    |
| Webhook URL     | `https://dev.selfship.dev/api/webhooks/github` |
| Webhook secret  | a long random string (`openssl rand -hex 32`)  |

Use the same permissions and events as that guide.

Then put its values in `dev.env`: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_APP_PRIVATE_KEY`.

The private key must be **one line**. Convert the downloaded `.pem` file with:

```bash
awk 'NF {printf "%s\\n", $0}' ~/Downloads/selfship-dev.*.private-key.pem
```

Paste the output after `GITHUB_APP_PRIVATE_KEY=`, then:

```bash
make env-push      # uploads and restarts the running version with the new settings
```

**SMTP** (verification and password-reset emails) works the same way: fill in the `SMTP_*` lines and `MAIL_FROM`, then run `make env-push`. Until it's set, sign-up works but emails aren't sent.

---

## After setup: everyday use

- **Deploying** is automatic: merge a PR into `main`, and about 15 minutes later it's on dev.selfship.dev.
- **If a deploy is broken,** the server rolls back to the previous version by itself, and the GitHub job shows red.
- **Roll back by hand** to any earlier commit: `make deploy SHA=<full commit sha>`.
- **Logs:** `make logs S=api` (or `worker`, `web`, `caddy`, `postgres`). Press Ctrl+C to stop.
- **Pause** to save credits: `make stop` (≈ $2/month; the site is offline). **Resume:** `make start`. Run `export CLOUDFLARE_API_TOKEN=…` in that terminal first, because `start` updates the DNS.
- **Backups:** made automatically every night (kept 7 days). `make backups` downloads the newest one.

All commands: `make help`. How it works inside: [infra/aws/platform-dev/README.md](../../infra/aws/platform-dev/README.md).

---

## Troubleshooting

| Problem                                                                       | What to do                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make up`: _Error: … Authentication error_ (Cloudflare)                       | The token isn't set in this terminal, or it doesn't cover selfship.dev. Repeat 1.1 and 1.3.                                                                                                                                  |
| `make up`: _not eligible for Free Tier_                                       | The instance type isn't allowed on your AWS plan. `t3.micro` (the default) is allowed.                                                                                                                                       |
| `make ready` / `make ssh`: _Connection timed out_ in the first minutes        | The server is still booting. Wait a minute and retry.                                                                                                                                                                        |
| `make ready` / `make ssh`: _Permission denied (publickey)_                    | Your IP isn't in `admin_cidrs`. Check it (`curl -s https://checkip.amazonaws.com`), fix `terraform.tfvars`, then destroy and recreate the server (`make down`, `make up`). The admin rule is set when the server is created. |
| Deploy job: _Permission denied (publickey)_ or _Host key verification failed_ | The server was recreated after Part 4. Run `make github-env` again, then re-run the job.                                                                                                                                     |
| Deploy job: _denied_ / _unauthorized_ pulling images                          | Part 6.2.                                                                                                                                                                                                                    |
| Deploy job: _.env is missing_                                                 | Part 3 (`make env-init` once, then `make env-push`).                                                                                                                                                                         |
| Site doesn't load right after the first deploy                                | Caddy is getting the HTTPS certificate. Wait 1–2 minutes. `make logs S=caddy` shows progress.                                                                                                                                |
| Site down after `make start`                                                  | DNS takes up to 60 s to follow the new IP. If it's still down, check that `CLOUDFLARE_API_TOKEN` was set when you ran `make start`.                                                                                          |

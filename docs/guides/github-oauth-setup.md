# Set up "Sign in with GitHub" (local development)

Optional. Without it, the GitHub button is hidden and email/password sign-in still works.

> In M2 we register a **GitHub App** (needed for repository access). GitHub Apps can also sign users in with the same endpoints, so we may switch login over to it then. For now a simple **OAuth App** is enough.

## 1. Create an OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (direct link: https://github.com/settings/applications/new)
2. Fill in:
   | Field                      | Value                                            |
   | -------------------------- | ------------------------------------------------ |
   | Application name           | `Platform (local)`                               |
   | Homepage URL               | `http://localhost:3000`                          |
   | Authorization callback URL | `http://localhost:3000/api/auth/github/callback` |
3. Click **Register application**
4. Copy the **Client ID**, then click **Generate a new client secret** and copy it

## 2. Configure the API

In the root `.env`:

```bash
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<client secret>
```

Restart `pnpm dev`. The login and sign-up pages now show **Continue with GitHub**.

## How it behaves

- **New GitHub user** → an account is created with the GitHub name, avatar and **verified primary email**. No password is set.
- **Existing account with the same email** → GitHub is linked to it. If that account had never verified its email, its password is removed and its sessions are signed out. This prevents someone from pre-registering your email and keeping access.
- **GitHub account without a verified email** → sign-in is refused, with a message on the login page.
- We only read your profile and email. The GitHub access token is discarded right after sign-in.

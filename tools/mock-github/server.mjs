// Mock GitHub for local development and UI testing. No dependencies.
//
// It imitates the GitHub endpoints Selfship uses (install page, OAuth code
// exchange, installation tokens, repositories, branches, contents) with a
// few fixture repositories, and can send signed webhooks to the API.
//
// Usage:  pnpm mock:github        (then follow the printed instructions)
// Never use this in production: it accepts any credentials.

import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_GITHUB_PORT ?? 4010);
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const WEBHOOK_SECRET = 'mock-webhook-secret';
const INSTALLATION_ID = 1001;
const ACCOUNT = { login: 'acme-demo', type: 'Organization', avatar_url: null };

const pkg = (value) => JSON.stringify(value, null, 2);

/** Fixture repositories: one per framework the wizard should detect. */
const REPOS = [
  {
    id: 501,
    name: 'next-blog',
    branches: ['main', 'develop'],
    files: {
      'package.json': pkg({
        name: 'next-blog',
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: { next: '16.4.0', react: '19.3.0', 'react-dom': '19.3.0' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0',
      '.nvmrc': '22',
      'next.config.ts': 'export default {};',
    },
  },
  {
    id: 502,
    name: 'vite-dashboard',
    branches: ['main'],
    files: {
      'package.json': pkg({
        name: 'vite-dashboard',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { react: '19.3.0' },
        devDependencies: { vite: '7.0.0' },
      }),
      'package-lock.json': '{}',
      'index.html': '<div id="root"></div>',
    },
  },
  {
    id: 503,
    name: 'landing-page',
    branches: ['main', 'gh-pages'],
    files: { 'index.html': '<h1>Hello</h1>', 'style.css': 'h1 { color: tomato }' },
  },
  {
    id: 504,
    name: 'platform-monorepo',
    branches: ['main'],
    files: {
      'package.json': pkg({ name: 'monorepo', private: true }),
      'apps/api/package.json': pkg({
        name: 'api',
        scripts: { build: 'nest build', start: 'node dist/main' },
        dependencies: { '@nestjs/core': '11.2.7' },
      }),
      'apps/api/package-lock.json': '{}',
    },
  },
  {
    id: 505,
    name: 'go-service',
    branches: ['main'],
    files: {
      Dockerfile:
        'FROM golang:1.23-alpine\nWORKDIR /src\nCOPY . .\nRUN go build -o /app\nEXPOSE 8080\nCMD ["/app"]',
      'go.mod': 'module example.com/go-service',
    },
  },
].map((repo, index) => ({
  ...repo,
  fullName: `${ACCOUNT.login}/${repo.name}`,
  pushedAt: new Date(Date.now() - index * 36e5 * 20).toISOString(),
}));

let installed = false;

/** GitHub-shaped repository JSON. */
const repoJson = (repo) => ({
  id: repo.id,
  name: repo.name,
  full_name: repo.fullName,
  owner: { login: ACCOUNT.login },
  private: repo.id % 2 === 1,
  default_branch: repo.branches[0],
  pushed_at: repo.pushedAt,
});

/** Directory listing for `dir` ('' = root), or null if it doesn't exist. */
function listDir(repo, dir) {
  const prefix = dir ? `${dir}/` : '';
  const entries = new Map();
  for (const file of Object.keys(repo.files)) {
    if (!file.startsWith(prefix)) continue;
    const [first, ...rest] = file.slice(prefix.length).split('/');
    entries.set(first, rest.length ? 'dir' : 'file');
  }
  if (entries.size === 0) return null;
  return [...entries].map(([name, type]) => ({ name, path: `${prefix}${name}`, type, size: 10 }));
}

/** Sends a signed webhook to the API, exactly like GitHub would. */
async function sendWebhook(event, payload) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`;
  const response = await fetch(`${API_URL}/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-Hub-Signature-256': signature,
      'X-GitHub-Delivery': `mock-${Date.now()}`,
    },
    body,
  });
  return `${response.status} ${await response.text()}`;
}

const installationPayload = () => ({
  id: INSTALLATION_ID,
  account: ACCOUNT,
  repository_selection: 'selected',
  suspended_at: null,
});

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const html = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><body style="font-family:system-ui;max-width:560px;margin:60px auto;line-height:1.5">${body}</body></html>`,
  );
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;
  const method = req.method ?? 'GET';
  console.log(`[mock-github] ${method} ${p}${url.search}`);

  // ── "github.com" pages ────────────────────────────────────────────────────
  if (method === 'GET' && /^\/apps\/[^/]+\/installations\/new$/.test(p)) {
    const callback = new URL('/api/github/setup', WEB_URL);
    callback.searchParams.set('installation_id', String(INSTALLATION_ID));
    callback.searchParams.set('setup_action', installed ? 'update' : 'install');
    callback.searchParams.set('code', 'mock-user-code');
    const state = url.searchParams.get('state');
    if (state) callback.searchParams.set('state', state);
    return html(
      res,
      `<p style="color:#888">Mock GitHub (local testing)</p><h2>Install Selfship</h2>
       <p>Install on <b>${ACCOUNT.login}</b> with access to ${REPOS.length} repositories.</p>
       <a id="install" href="${callback}" style="background:#1f883d;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Install</a>`,
    );
  }
  if (method === 'GET' && /^\/(organizations\/[^/]+\/)?settings\/installations\/\d+$/.test(p)) {
    return html(
      res,
      `<p style="color:#888">Mock GitHub (local testing)</p><h2>Selfship installation on ${ACCOUNT.login}</h2>
       <form method="post" action="/__mock/uninstall"><button>Uninstall (sends webhook)</button></form>
       <form method="post" action="/__mock/suspend"><button>Suspend (sends webhook)</button></form>
       <form method="post" action="/__mock/unsuspend"><button>Unsuspend (sends webhook)</button></form>`,
    );
  }
  if (method === 'POST' && p === '/login/oauth/access_token') {
    installed = true;
    return json(res, 200, { access_token: 'mock-user-token' });
  }

  // ── Mock controls ─────────────────────────────────────────────────────────
  if (method === 'POST' && p.startsWith('/__mock/')) {
    const action = p.slice('/__mock/'.length);
    const event = action === 'uninstall' ? 'deleted' : action;
    if (action === 'uninstall') installed = false;
    const result = await sendWebhook('installation', {
      action: event,
      installation: {
        ...installationPayload(),
        suspended_at: action === 'suspend' ? new Date().toISOString() : null,
      },
    });
    return html(
      res,
      `<p>Sent <code>installation.${event}</code> webhook → API answered <code>${result}</code>.</p><p><a href="${WEB_URL}/dashboard">Back to Selfship</a></p>`,
    );
  }

  // ── REST API ──────────────────────────────────────────────────────────────
  if (method === 'GET' && p === '/user/installations') {
    return json(res, 200, { total_count: 1, installations: [{ id: INSTALLATION_ID }] });
  }
  if (method === 'GET' && p === `/app/installations/${INSTALLATION_ID}`)
    return json(res, 200, installationPayload());
  if (method === 'POST' && p === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
    return json(res, 201, {
      token: 'mock-installation-token',
      expires_at: new Date(Date.now() + 36e5).toISOString(),
    });
  }
  if (method === 'GET' && p === '/installation/repositories') {
    return json(res, 200, { total_count: REPOS.length, repositories: REPOS.map(repoJson) });
  }

  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
  if (method === 'GET' && repoMatch) {
    const repo = REPOS.find(
      (r) =>
        r.fullName === `${decodeURIComponent(repoMatch[1])}/${decodeURIComponent(repoMatch[2])}`,
    );
    if (!repo) return json(res, 404, { message: 'Not Found' });
    const rest = repoMatch[3] ?? '';
    if (rest === '') return json(res, 200, repoJson(repo));
    if (rest === '/branches')
      return json(
        res,
        200,
        repo.branches.map((name) => ({ name })),
      );
    if (rest.startsWith('/branches/')) {
      const branch = decodeURIComponent(rest.slice('/branches/'.length));
      return repo.branches.includes(branch)
        ? json(res, 200, { name: branch })
        : json(res, 404, { message: 'Branch not found' });
    }
    if (rest === '/contents' || rest.startsWith('/contents/')) {
      const filePath = decodeURIComponent(rest.slice('/contents'.length).replace(/^\//, ''));
      if (Object.hasOwn(repo.files, filePath)) {
        const content = Buffer.from(repo.files[filePath]).toString('base64');
        return json(res, 200, {
          type: 'file',
          encoding: 'base64',
          content,
          size: repo.files[filePath].length,
        });
      }
      const dir = listDir(repo, filePath);
      return dir ? json(res, 200, dir) : json(res, 404, { message: 'Not Found' });
    }
  }

  json(res, 404, { message: 'Not Found (mock)' });
});

// A throwaway key so the API's GitHub client can start; the mock never checks signatures.
const here = path.dirname(fileURLToPath(import.meta.url));
const devDir = path.resolve(here, '../../.dev');
mkdirSync(devDir, { recursive: true });
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const envLines = [
  'GITHUB_APP_ID=1',
  'GITHUB_APP_SLUG=selfship-mock',
  'GITHUB_APP_CLIENT_ID=Iv1.mock',
  'GITHUB_APP_CLIENT_SECRET=mock-secret',
  `GITHUB_APP_PRIVATE_KEY="${pem.trim().replace(/\n/g, '\\n')}"`,
  `GITHUB_WEBHOOK_SECRET=${WEBHOOK_SECRET}`,
  `GITHUB_API_URL=http://localhost:${PORT}`,
  `GITHUB_WEB_URL=http://localhost:${PORT}`,
];
writeFileSync(path.join(devDir, 'mock-github.env'), `${envLines.join('\n')}\n`);

server.listen(PORT, () => {
  console.log(`\nMock GitHub listening on http://localhost:${PORT}`);
  console.log(`Wrote API settings to .dev/mock-github.env. Start the API with them, e.g.:`);
  console.log(`  set -a; source .dev/mock-github.env; set +a; pnpm dev\n`);
});

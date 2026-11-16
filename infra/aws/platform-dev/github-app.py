#!/usr/bin/env python3
"""Create this environment's GitHub App in one click (GitHub's manifest flow).

Opens GitHub's "create app" page with every setting filled in (the same as
docs/guides/github-app-setup.md); after you click "Create", GitHub sends the
app's credentials back here, and they're written into dev.env. Nothing secret
is printed. Usage: make github-app (then make env-push).
"""

import http.server
import json
import pathlib
import re
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser

PORT = 8765
ENV_FILE = pathlib.Path(__file__).with_name("dev.env")


def manifest(domain: str, name: str) -> dict:
    """GitHub App settings for a Selfship environment."""
    base = f"https://{domain}"
    return {
        "name": name,
        "url": base,
        "hook_attributes": {"url": f"{base}/api/webhooks/github", "active": True},
        "redirect_url": f"http://127.0.0.1:{PORT}/callback",
        "callback_urls": [f"{base}/api/github/setup"],
        "request_oauth_on_install": True,
        "setup_on_update": True,
        "public": False,
        "default_permissions": {"contents": "read", "metadata": "read"},
        "default_events": ["push"],
    }


def set_env(values: dict) -> None:
    """Replaces (or appends) KEY=value lines in dev.env, keeping everything else."""
    text = ENV_FILE.read_text()
    for key, value in values.items():
        line = f"{key}={value}"
        if re.search(rf"^{key}=", text, flags=re.M):
            text = re.sub(rf"^{key}=.*$", lambda _: line, text, flags=re.M)
        else:
            text += f"\n{line}\n"
    ENV_FILE.write_text(text)
    ENV_FILE.chmod(0o600)


def main() -> None:
    domain = sys.argv[1] if len(sys.argv) > 1 else "dev.selfship.dev"
    name = sys.argv[2] if len(sys.argv) > 2 else "Selfship Dev"
    if not ENV_FILE.exists():
        sys.exit("dev.env not found: run make env-init first.")
    state = secrets.token_urlsafe(16)
    form = f"""<!doctype html><meta charset="utf-8"><title>Create the GitHub App</title>
<body style="font-family:system-ui;max-width:36rem;margin:3rem auto">
<h1>Create “{name}”</h1>
<p>GitHub will open with every setting filled in. Check the name, then click <b>Create GitHub App</b>.</p>
<form method="post" action="https://github.com/settings/apps/new?state={state}">
<input type="hidden" name="manifest" value='{json.dumps(manifest(domain, name)).replace("'", "&#39;")}'>
<button style="font-size:1.1rem;padding:.6rem 1.2rem">Continue to GitHub</button></form></body>"""

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the terminal quiet
            pass

        def reply(self, body: str) -> None:
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode())

        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            if url.path != "/callback":
                return self.reply(form)
            query = urllib.parse.parse_qs(url.query)
            if query.get("state", [""])[0] != state or "code" not in query:
                return self.reply("<p>Unexpected callback (state mismatch). Start again with make github-app.</p>")
            request = urllib.request.Request(
                f"https://api.github.com/app-manifests/{query['code'][0]}/conversions",
                method="POST",
                headers={"Accept": "application/vnd.github+json"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                app = json.load(response)
            set_env({
                "GITHUB_APP_ID": app["id"],
                "GITHUB_APP_SLUG": app["slug"],
                "GITHUB_APP_CLIENT_ID": app["client_id"],
                "GITHUB_APP_CLIENT_SECRET": app["client_secret"],
                "GITHUB_WEBHOOK_SECRET": app["webhook_secret"],
                # One line with \n escapes; the app accepts both forms.
                "GITHUB_APP_PRIVATE_KEY": app["pem"].strip().replace("\n", "\\n"),
            })
            print(f"✓ Created {app['html_url']} (id {app['id']}); credentials written to dev.env")
            self.reply(f"<p>✓ “{app['name']}” created. Credentials saved to dev.env. You can close this tab.</p>")
            self.server.done = True

    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    server.done = False
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Open {url} in your browser (trying to open it for you)…")
    webbrowser.open(url)
    while not server.done:
        server.handle_request()


if __name__ == "__main__":
    main()

# Unmanaged Server Reference (Ubuntu)

This is a single-sheet reference for the live production layout, last verified
2026-08-24. Paths are Ubuntu-standard, and every config path is listed
explicitly.

## Quick IP Reference

- **prod server** (`mytlom.com`): `23.254.144.125`
- **Chapeaux Fous** (`chapeauxfous.com`): `23.254.144.125`
- **dev server** (`dev.mytlom.com`): `108.174.197.50`
- **local workstation public IP at Mill on Flax** (for firewall allowlists): `71.72.171.61`

## Base Folder Structure

```
/srv/
  nathanruffing.com/
  timev3technology.com/
  time-v3-astroclock4/
    api/                         # Node API via PM2 on :5001
    client/dist/                 # static files served directly by nginx
    awim/                        # Python API via systemd on :5011
  tlom2/
    api/                         # Node API via PM2 on :5002
    client/dist/                 # static files served directly by nginx
  keystone-tools/
    api/                         # Node API via PM2 on :5003
    client/                      # no public frontend route
  chapeauxfous-accounting/
    api/                         # Node API on :5004
    client/dist/                 # static files served directly by nginx
  awim/                          # retained temporarily as pre-monorepo rollback
  shared/
```

Chapeaux Fous and OpenClaw are user-scoped rather than installed under `/srv`.
The Chapeaux Fous deployment retains its `agent-slayer` internal service and
state names for compatibility:

```text
/home/nate/
  code/agent-slayer/                   # Chapeaux Fous production app; legacy internal path
  .npm-global/lib/node_modules/openclaw/   # application package
  .openclaw/                              # config, state, auth, logs, generated runtime files
  .config/systemd/user/openclaw-gateway.service
  code/slayer-agent/                      # OpenClaw agent workspace
```

## Hosted Sites (domains → service)

- `nathanruffing.com` / `www.nathanruffing.com` → WordPress (`/srv/nathanruffing.com`, vhost: `/etc/nginx/sites-available/nathanruffing.com.conf`)
- `timev3technology.com` / `www.timev3technology.com` → WordPress (`/srv/timev3technology.com`, vhost: `/etc/nginx/sites-available/timev3technology.com.conf`)
- `timev3tech.com` / `www.timev3tech.com` → redirect to `timev3technology.com` (vhost: `/etc/nginx/sites-available/timev3tech.com.conf`)
- `timev3.com` / `www.timev3.com` → Time v3 Astronomical Clock (vhost: `/etc/nginx/sites-available/timev3.com.conf`)
- `mytlom.com` / `www.mytlom.com` → TLOM (vhost: `/etc/nginx/sites-available/mytlom.com.conf`)
- `awim.timev3tech.com` → AWIM Python API (`/srv/time-v3-astroclock4/awim`, vhost: `/etc/nginx/sites-available/awim.conf`)
- `chapeauxfous.com` / `www.chapeauxfous.com` → Chapeaux Fous (`127.0.0.1:8787`, vhost: `/etc/nginx/sites-available/chapeauxfous.com.conf`)
- `accounting.chapeauxfous.com` → Chapeaux Fous Accounting (`/srv/chapeauxfous-accounting`, API on `127.0.0.1:5004`, vhost: `/etc/nginx/sites-available/accounting.chapeauxfous.com.conf`)
- `agent.nathanruffing.com` → retained legacy Chapeaux Fous hostname (vhost: `/etc/nginx/sites-available/agent.nathanruffing.com.conf`; redirect status was not captured during the migration)
- `https://hwsrv-1263600.taile5d9ca.ts.net:8443` → OpenClaw Gateway through Tailscale Serve; this endpoint is tailnet-only and does not pass through nginx
- Keystone Tools has no public frontend route.

## Ports (listeners)

- SSH: 22
- DNS stub resolver (systemd-resolved): 53 (127.0.0.53, 127.0.0.54)
- HTTP: 80 (nginx)
- HTTPS: 443 (nginx)
- Time V3 Node API: 5001 (PM2; reached publicly through nginx `/api/`)
- TLOM Node API: 5002 (PM2; reached publicly through nginx)
- Keystone Tools Node API: 5003 (PM2; no public frontend route)
- Chapeaux Fous Accounting Node API: 5004 (`127.0.0.1` only; reached publicly through nginx `/api/` and `/mcp`)
- AWIM Python API: 5011 (systemd; reached publicly through nginx)
- Chapeaux Fous: 8787 (`127.0.0.1` only; public access is through nginx; systemd service remains `agent-slayer.service`)
- OpenClaw Gateway: 18789 (`127.0.0.1` and `::1` only)
- OpenClaw tailnet HTTPS: 8443 (Tailscale Serve; not a conventional host listener and not public Funnel traffic)
- MariaDB: 3306 (mariadbd)

### Uploads / user files

- TLOM, Codified uploads: `/srv/tlom2/api/uploads/`
- Time v3 clock images: `/srv/time-v3-astroclock4/api/public/clockimages/`
- Chapeaux Fous Accounting resumable import artifacts: `/srv/chapeauxfous-accounting/api/data/artifacts/`
- Chapeaux Fous Accounting durable statement evidence: `/srv/chapeauxfous-accounting/api/data/evidence/`
- WordPress uploads: `/srv/nathanruffing.com/wp-content/uploads/`
- WordPress uploads: `/srv/timev3technology.com/wp-content/uploads/`

## Nginx (reverse proxy + static)

- Main config: `/etc/nginx/nginx.conf`
- Site configs:
  - `/etc/nginx/sites-available/nathanruffing.com.conf`
  - `/etc/nginx/sites-available/timev3technology.com.conf`
  - `/etc/nginx/sites-available/timev3tech.com.conf`
  - `/etc/nginx/sites-available/mytlom.com.conf`
  - `/etc/nginx/sites-available/timev3.com.conf`
  - `/etc/nginx/sites-available/awim.conf`
  - `/etc/nginx/sites-available/chapeauxfous.com.conf`
  - `/etc/nginx/sites-available/accounting.chapeauxfous.com.conf`
  - `/etc/nginx/sites-available/agent.nathanruffing.com.conf`
- Enabled symlinks:
  - `/etc/nginx/sites-enabled/nathanruffing.com.conf`
  - `/etc/nginx/sites-enabled/timev3technology.com.conf`
  - `/etc/nginx/sites-enabled/timev3tech.com.conf`
  - `/etc/nginx/sites-enabled/mytlom.com.conf`
  - `/etc/nginx/sites-enabled/timev3.com.conf`
  - `/etc/nginx/sites-enabled/awim.conf`
  - `/etc/nginx/sites-enabled/chapeauxfous.com.conf`
  - `/etc/nginx/sites-enabled/accounting.chapeauxfous.com.conf`
  - `/etc/nginx/sites-enabled/agent.nathanruffing.com.conf`

### Time V3 nginx routing

The Time V3 client is static in production; it does not need a PM2 process or
an application port:

```text
browser -> https://timev3.com -> nginx:443
        -> /srv/time-v3-astroclock4/client/dist

browser -> https://timev3.com/api/* -> nginx:443
        -> http://tv3_api -> PM2 tv3clock-api on :5001
```

AWIM remains a separate Python process inside the Time V3 monorepo:

```text
browser/API -> https://awim.timev3tech.com -> nginx:443
            -> http://127.0.0.1:5011 -> awim.service
```

### Chapeaux Fous Accounting nginx routing

The Accounting client is served as static files, while its REST API and
Streamable HTTP MCP endpoint are proxied to the same loopback Node API:

```text
browser -> https://accounting.chapeauxfous.com -> nginx:443
        -> /srv/chapeauxfous-accounting/client/dist

browser/API -> https://accounting.chapeauxfous.com/api/* -> nginx:443
            -> http://127.0.0.1:5004/api/*

MCP client -> https://accounting.chapeauxfous.com/mcp -> nginx:443
           -> http://127.0.0.1:5004/mcp

Artifact upload -> https://accounting.chapeauxfous.com/mcp/artifacts/* -> nginx:443
                -> http://127.0.0.1:5004/mcp/artifacts/*

Statement evidence download -> https://accounting.chapeauxfous.com/mcp/evidence-files/*/content -> nginx:443
                            -> http://127.0.0.1:5004/mcp/evidence-files/*/content
```

- Nginx vhost: `/etc/nginx/sites-available/accounting.chapeauxfous.com.conf`
- The exact `location = /mcp` route preserves the public `/mcp` path, forwards
  the `Authorization` header, disables proxy buffering and caching, and uses a
  3600-second proxy read timeout for streaming.
- A separate `location ^~ /mcp/` route is required for provider-advertised MCP
  data-plane paths such as `/mcp/artifacts`. It uses the same upstream and
  authorization headers, disables request and response buffering, and permits
  2 MiB request bodies so Accounting's 1 MiB raw upload chunks pass intact.
  Without this prefix route, nginx sends artifact POST/PATCH requests to the
  static client location and returns HTTP 405 before Accounting receives them.
- The MCP endpoint uses a revocable `cfacct_...` bearer token. An unauthenticated
  `POST /mcp` returning JSON HTTP 401 is the expected proxy-routing health check.
- An unauthenticated `POST /mcp/artifacts` must likewise return Accounting's
  JSON HTTP 401 response. HTML HTTP 405 proves that the prefix route is missing.

The artifact prefix block is:

```nginx
location ^~ /mcp/ {
    proxy_pass http://127.0.0.1:5004;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
    proxy_buffering off;
    client_max_body_size 2m;
    proxy_read_timeout 3600s;
}
```
- The live public route was verified on 2026-08-24 after adding the dedicated
  nginx location; before that change, `POST /mcp` fell through to the static
  client route and nginx returned its HTML HTTP 405 response.

### Chapeaux Fous nginx routing

Chapeaux Fous remains bound to loopback and is published through nginx:

```text
browser -> https://chapeauxfous.com -> nginx:443
        -> http://127.0.0.1:8787 -> agent-slayer user service
```

- Public origin: `https://chapeauxfous.com`
- Nginx vhost: `/etc/nginx/sites-available/chapeauxfous.com.conf`
- Upstream: `http://127.0.0.1:8787`
- OAuth callback pattern: `https://chapeauxfous.com/api/integrations/<server-name>/oauth/callback`.
- The vhost must preserve `Host`, `X-Forwarded-Proto`, `X-Real-IP`, and `X-Forwarded-For`.
- Keep port `8787` off the public firewall; only nginx should reach it.
- Allow at least `60M` request bodies so the application's configured `50M` voice-upload limit remains usable.
- Do not add nginx `listen [::]:443` on this host. Tailscale owns the tailnet IPv6 address on port 443, so an nginx wildcard IPv6 listener fails with `bind() to [::]:443 failed (98: Address already in use)`. Chapeaux Fous uses nginx's IPv4 `listen 443 ssl`; its port 80 listener may remain dual-stack.
- If nginx has been fully stopped, Tailscale may claim a specific tailnet IPv4
  listener on port 443 before nginx can reclaim `0.0.0.0:443`. After confirming
  SSH is connected through the public server IP, recover the listener order
  with `sudo systemctl stop tailscaled`, `sudo systemctl start nginx`, then
  `sudo systemctl start tailscaled`. Always restart Tailscale even if nginx
  fails to start.

OAuth providers redirect the browser to the public callback above; they do not
connect directly to loopback port `8787`. Therefore `SLAYER_PUBLIC_URL`, public
DNS, nginx routing, and a valid HTTPS certificate must all be working before an
OAuth connection can complete. Each self-hosted Chapeaux Fous instance needs its
own browser-accessible HTTPS origin for browser-based OAuth.

### OpenClaw-related nginx routing

OpenClaw itself is **not** behind nginx. Its browser/gateway traffic follows this path:

```text
tailnet client
  -> Tailscale Serve HTTPS :8443
  -> http://127.0.0.1:18789
  -> OpenClaw Gateway
```

Nginx is involved when OpenClaw connects back to TLOM as an MCP client. The active `mytlom.com.conf` has these relevant rules:

- `location ^~ /.well-known/` proxies to `http://tlom_api` and preserves the public discovery path.
- `location ^~ /oauth/` proxies to `http://tlom_api` and preserves the OAuth path.
- `location /api/` proxies to `http://tlom_api/`; therefore public `https://mytlom.com/api/mcp` reaches the API's `/mcp` route.
- The discovery/OAuth locations forward `Host`, `X-Forwarded-Proto`, `X-Real-IP`, and `X-Forwarded-For`, which the OAuth flow needs to reconstruct its public HTTPS origin correctly.
- The vhost sets `client_max_body_size 20M` and serves `/srv/tlom2/client/dist` directly for the web client.
- `/etc/nginx/sites-available/my-sites.conf` still exists as a disabled legacy combined vhost. It is not in `sites-enabled`.

## SSL / Certs

- Let’s Encrypt config: `/etc/letsencrypt/`
- Certs: `/etc/letsencrypt/live/<domain>/fullchain.pem`
- Keys: `/etc/letsencrypt/live/<domain>/privkey.pem`
- Auto-renew timer: `/lib/systemd/system/certbot.timer` (or cron at `/etc/cron.d/certbot`); inspect its actual schedule with `systemctl list-timers certbot.timer`.
- Manual renew: `sudo certbot renew` (use `sudo certbot renew --dry-run` to test)
- Most pre-existing public sites use the shared certificate named
  `timev3technology.com`; its certificate and key are under
  `/etc/letsencrypt/live/timev3technology.com/`. It includes the legacy
  `agent.nathanruffing.com` hostname and expires on 2026-11-14.
- Chapeaux Fous uses a separate certificate under
  `/etc/letsencrypt/live/chapeauxfous.com/`. It includes
  `chapeauxfous.com` and `www.chapeauxfous.com` and expires on 2026-11-22.
- Certbot added an incompatible `[::]:443` listener to the Chapeaux Fous vhost
  during issuance. That line was removed because Tailscale already owns the
  tailnet IPv6 address on port 443.

After changing this vhost or shared certificate, verify the configuration that
nginx is actually serving rather than relying only on Certbot's success output:

```bash
sudo nginx -t
sudo systemctl reload nginx
openssl s_client -connect 127.0.0.1:443 -servername chapeauxfous.com \
  </dev/null 2>/dev/null | openssl x509 -noout -dates -ext subjectAltName
curl -sS -o /dev/null -w 'HTTPS: %{http_code}\n' https://chapeauxfous.com/
curl -sS -o /dev/null -w 'HTTP: %{http_code} redirect=%{redirect_url}\n' \
  http://chapeauxfous.com/
```

## Node APIs (TLOM, Keystone Tools + Time V3)

- PM2-managed entry points:
  - `/srv/tlom2/api/index.js`
  - `/srv/time-v3-astroclock4/api/index.js`
  - `/srv/keystone-tools/api/index.js`
- PM2 ecosystem: `/srv/pm2/ecosystem.config.js`
- PM2 systemd unit: `/etc/systemd/system/pm2-nate.service`
- PM2 manages the three Node APIs only. The obsolete `tlom-viteserve`,
  `tv3clock-viteserve`, and `keystone-viteserve` processes were removed on
  2026-08-18.
- The TLOM API includes in-process maintenance workers, so it must remain under
  reliable process supervision. PM2 is the current supervisor; systemd would
  be a possible replacement, but an unmanaged `node` process is not.
- Build the Time V3 and TLOM clients with their normal `npm run build`
  commands. Nginx immediately serves the resulting `client/dist` files; there
  is no frontend process to restart.

## Chapeaux Fous (internal name: Agent Slayer)

Production layout as of the 2026-08-23 domain migration:

- Production working directory last observed during the migration:
  `/home/nate/code/agent-slayer`
- Current development clone: `/home/nate/code/agent-chapeaux-fous`
- GitHub remote: `git@github.com:rr34/agent-chapeaux-fous.git`
- Application listener: `127.0.0.1:8787`
- Public origin: `https://chapeauxfous.com`
- Environment: `/home/nate/code/agent-slayer/.env` (untracked; contains access credentials)
- SQLite data: `/home/nate/code/agent-slayer/data/agent.sqlite`
- Isolated Codex home and ChatGPT authorization: `/home/nate/code/agent-slayer/data/codex-home/`
- Media: `/home/nate/code/agent-slayer/media/`
- OAuth client registrations and tokens: `/home/nate/.local/state/agent-slayer/mcp-oauth/`
- User systemd unit: `/home/nate/.config/systemd/user/agent-slayer.service`
- Reference unit in the repository: `/home/nate/code/agent-slayer/systemd/agent-slayer.service.example`
- Nginx vhost: `/etc/nginx/sites-available/chapeauxfous.com.conf`
- DNS: `chapeauxfous.com A 23.254.144.125` and
  `www.chapeauxfous.com CNAME chapeauxfous.com`

Migration verification captured on 2026-08-23 at approximately 22:18 EDT:

- Nginx and Tailscale were both active after restoring their listener order.
- Nginx owned public IPv4 ports 80 and 443; Tailscale retained the tailnet IPv6
  port 443 listener and its HTTPS service on port 8443.
- The served certificate had CN `chapeauxfous.com` and SANs for both the apex
  and `www` names.
- HTTPS reached the Chapeaux Fous application. An unauthenticated `HEAD` request
  returned HTTP 401, which is expected for this protected application.
- Browser credentials are origin-scoped, so the access token must be entered
  again at the new hostname. OAuth integrations may also require reconnection
  after changing `SLAYER_PUBLIC_URL`.
- The legacy hostname's final redirect behavior was not captured. Verify it
  before disabling or removing `/etc/nginx/sites-available/agent.nathanruffing.com.conf`.

Pre-domain-migration live snapshot, captured 2026-08-16 at approximately
16:21 UTC:

- The then-current `agent.nathanruffing.com` origin returned Chapeaux Fous
  (still named Agent Slayer at the time) with HTTP 200; HTTP redirected to HTTPS.
- Shared certificate includes `agent.nathanruffing.com` and expires 2026-11-14.
- User service was enabled and running clean revision `a5c322c7`.
- SQLite and the committed schema-semantic catalog agreed at schema version 11.
- Native logging and generic import tools were registered.
- TLOM and Weather were connected. Nutrition was OAuth-enabled and awaiting
  browser authorization in this particular health snapshot.

Nutrition OAuth was subsequently completed successfully and its historical
entries were migrated into Chapeaux Fous's generic native logging tables. It is
not intended as an ongoing dependency and was disconnected through Chapeaux Fous
on 2026-08-16 after that migration completed. The local OAuth registration and
tokens were removed. This local disconnect does not promise to revoke the
provider-side grant. The Nutrition entry may remain enabled and reconnectable
in `config/mcp-servers.json`; disabling that entry is a separate configuration
choice if it should no longer be offered after deployment.

The revision and schema values above are historical observations, not desired
versions. After every deployment, use `/health`, `git rev-parse --short HEAD`,
and `npm run db:verify` to establish the new live state.

The production `.env` must contain at least the listener/public-origin settings
and private access token below. Keep any enabled MCP credentials in the same
untracked file:

```dotenv
SLAYER_HOST=127.0.0.1
SLAYER_PORT=8787
SLAYER_PUBLIC_URL=https://chapeauxfous.com
SLAYER_ACCESS_TOKEN=<private-random-secret>
# Required while the TLOM MCP entry remains enabled:
TLOM_ACCESS_TOKEN=<private-tlom-token>
```

Chapeaux Fous is intentionally not managed by PM2. Run these as `nate`, without
`sudo`, for the user service:

```bash
systemctl --user status agent-slayer.service --no-pager
systemctl --user restart agent-slayer.service
journalctl --user -u agent-slayer.service -n 100 --no-pager
curl -I http://127.0.0.1:8787/
curl -sS https://chapeauxfous.com/health
```

For an application update containing database migrations, stop the service
before touching the SQLite database:

```bash
cd /home/nate/code/agent-slayer
git status --short
systemctl --user stop agent-slayer.service
git pull --ff-only
# `npm ci` deliberately deletes and reconstructs `node_modules`. Run it when
# package.json/package-lock.json changed, or when a clean dependency rebuild is
# wanted; otherwise it may be skipped for a routine application-only pull.
npm ci
npm run schema:migrate -- --no-semantics
npm run db:verify
systemctl --user start agent-slayer.service
systemctl --user status agent-slayer.service --no-pager
journalctl --user -u agent-slayer.service -n 100 --no-pager
git rev-parse --short HEAD
curl -sS https://chapeauxfous.com/health
```

Do not start the service if migration or verification fails. The
`--no-semantics` deployment flag prevents the server from changing the tracked
`db/schema-semantics.json`; the catalog is committed from development, while the
runtime compiler only selects relevant projections from it.

Require a clean production worktree before `git pull --ff-only`. If
`db/schema-semantics.json` is unexpectedly dirty, inspect it with
`git diff -- db/schema-semantics.json`. When the only change is a server-created
`extractedAt` timestamp and the incoming commit contains the authoritative
development catalog, discard that confirmed timestamp-only change with
`git restore -- db/schema-semantics.json` before pulling. Never discard broader
semantic edits without inspecting them. `npm ci` reconstructs `node_modules`
from the lockfile, which explains why it reports installed packages even when a
previous dependency tree existed. The migration runner creates a SQLite backup
before applying pending migrations.

OAuth configuration is deliberately split:

- `config/mcp-servers.json` declares whether an MCP server and OAuth flow are
  available to the application.
- `/home/nate/.local/state/agent-slayer/mcp-oauth/` contains private runtime
  registrations and tokens and must never be committed.
- `SLAYER_PUBLIC_URL` supplies the externally reachable origin used to form
  callback URLs.
- The Integrations UI initiates authorization and local disconnection; no
  provider access token belongs in the tracked repository.

## OpenClaw agent gateway

Live configuration observed on 2026-08-02:

- OpenClaw version: `2026.7.1-2`
- Install method/path: npm global package under Nate's user prefix at `/home/nate/.npm-global/lib/node_modules/openclaw`
- CLI symlink: `/home/nate/.npm-global/bin/openclaw`
- Config and private state root: `/home/nate/.openclaw/` (directory mode `0700`)
- Main config: `/home/nate/.openclaw/openclaw.json` (contains the gateway token and auth profiles; never paste it into documentation or logs)
- Agent workspace: `/home/nate/code/slayer-agent`
- Service: Nate's **user** systemd unit at `/home/nate/.config/systemd/user/openclaw-gateway.service`
- Unit state: enabled, with `Restart=always`, `RestartSec=5`, and `KillMode=control-group`
- User lingering: enabled for `nate`, so the user service can start at boot and keep running without an interactive login
- Gateway process: `/usr/bin/node .../openclaw/dist/index.js gateway --port 18789`
- Gateway mode/bind: `local`, loopback-only, port `18789`
- Gateway authentication: token mode; token is stored in the private config and is intentionally omitted here
- OpenClaw's built-in `gateway.tailscale.mode` is `off`; exposure is configured separately with the Tailscale CLI's persistent Serve configuration
- Control UI currently has `allowInsecureAuth: true`; the gateway is still protected by token auth and reachable remotely only through the tailnet Serve route
- Primary model: `openai/gpt-5.6-terra`; enabled plugins include `openai` and `codex`; tool profile is `coding`
- Sensitive node commands denied in config include camera capture, screen recording, contact/calendar/reminder creation, and SMS operations

Configured remote MCP servers:

- TLOM: `https://mytlom.com/api/mcp` (`streamable-http`, OAuth)
- Nutrition: `https://nutrition-mcp.com/mcp` (`streamable-http`)
- Weather: `https://open-meteo.caseyjhand.com/mcp` (`streamable-http`, filtered to location search and forecast tools)

These are OpenClaw's own MCP settings, separate from Chapeaux Fous's
`config/mcp-servers.json` and OAuth state. Connecting or disconnecting Nutrition
in Chapeaux Fous does not change OpenClaw's configuration.

Useful service commands (run as `nate`, without `sudo`):

```bash
openclaw --version
systemctl --user status openclaw-gateway.service
systemctl --user restart openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -f
curl -I http://127.0.0.1:18789/
```

Observed follow-ups as of 2026-08-02:

- The gateway is healthy and returned HTTP 200 both directly on loopback and through Tailscale HTTPS.
- TLOM MCP is configured but its OAuth login is not complete. The journal repeatedly reports that it requires authorization; complete it with `openclaw mcp login tlom` in an interactive session as `nate`.
- The journal reports proxy headers from an untrusted address when accessed through Tailscale Serve. If OpenClaw should treat the proxied tailnet connection as local, configure `gateway.trustedProxies` narrowly for the actual local Tailscale Serve proxy source; do not add a broad network range without verifying the source address.

### Nginx vs PM2 (explicit roles)

- **Nginx** is the public edge service on ports **80/443**. It terminates TLS,
  routes hosts and paths, serves static client files, and proxies API requests.
- **PM2** supervises the long-running Node API processes on internal ports
  `5001`, `5002`, and `5003`.
- Static client flow: browser → nginx → `client/dist` files.
- Node API flow: browser/app → nginx → `127.0.0.1:<api-port>` → PM2 process.
- AWIM flow: browser/API → nginx → `127.0.0.1:5011` → systemd service.
- Do not add PM2 `serve`/`viteserve` processes for production Vite builds when
  the corresponding nginx vhost already serves `client/dist` directly.

### Quick verification commands

- Show PM2 processes and ports (what is actually running Node):
  - `pm2 list`
  - `pm2 show <name>`
  - `cat /srv/pm2/ecosystem.config.js`
- Show nginx routing (what is exposed publicly):
  - `sudo nginx -T | less`
  - `ls -l /etc/nginx/sites-enabled/`

## Python app (awim)

- AWIM is part of the Time V3 monorepo.
- App dir: `/srv/time-v3-astroclock4/awim/`
- Virtualenv: `/srv/time-v3-astroclock4/awim/.venv/`
- Systemd unit: `/etc/systemd/system/awim.service`
- Environment file: `/srv/time-v3-astroclock4/awim/.env`
- Active service command: `/srv/time-v3-astroclock4/awim/.venv/bin/python -m uvicorn tv3clock_api:app --host 0.0.0.0 --port ${PORT}`
- The old `/srv/awim/` checkout and
  `/etc/systemd/system/awim.service.pre-monorepo-2026-08-18` are temporary
  rollback assets. They are not the active runtime.

### AWIM nightly cache

The consolidated AWIM cache runner is
`/srv/time-v3-astroclock4/awim/tv3clock/cache_runner.py`. Schedule it for fixed
midnight at UTC-8, which is `08:00 UTC` every day. This is intentionally a
fixed UTC-8 schedule rather than a daylight-saving local-time schedule.

- Systemd service: `/etc/systemd/system/awim-nightly-cache.service`
- Systemd timer: `/etc/systemd/system/awim-nightly-cache.timer`
- Working directory: `/srv/time-v3-astroclock4/awim/`
- Environment file: `/srv/time-v3-astroclock4/awim/.env`
- Command: `/srv/time-v3-astroclock4/awim/.venv/bin/python -m tv3clock.cache_runner`
- Schedule: daily at `08:00 UTC` (`OnCalendar=*-*-* 08:00:00 UTC`)
- Logs: one file per run under
  `/srv/time-v3-astroclock4/awim/cache_logs/`
- Lock file: `/tmp/awim_nightly_cache.lock`; a second overlapping invocation
  exits without starting another cache run.

The runner processes a 24-hour cache window with two hours of overlap, for a
26-hour total processing window. It runs `locations_cluster` before the other
cache jobs in each nightly cycle.

This timer configuration has not yet been verified on the live server. After
installing or changing it, use:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now awim-nightly-cache.timer
systemctl status awim-nightly-cache.timer --no-pager
systemctl list-timers awim-nightly-cache.timer
journalctl -u awim-nightly-cache.service -n 100 --no-pager
ls -lt /srv/time-v3-astroclock4/awim/cache_logs/
```

## Databases (MariaDB)

- MariaDB was chosen intentionally for prod/dev.

- Server config:
  - `/etc/mysql/my.cnf`
  - `/etc/mysql/mariadb.conf.d/50-server.cnf`
- Data dir: `/var/lib/mysql/`
- Socket: `/var/run/mysqld/mysqld.sock`

### Database layout (separate DBs)

- Note: the repo/folder is `tlom2`, but the production MariaDB database name is `tlom`.

- Databases:
  - `nathanruffing_wp`
  - `timev3technology_wp`
  - `tlom`
  - `awim`
  - `keystonedata`

### DB users (scoped per DB)

- `timev3technology_wp_user` → `timev3technology_wp`
- `nathanruffing_wp_user` → `nathanruffing_wp`
- `tlom_user` → `tlom`
- `awim_user` → `awim`

## Secrets / env

- TLOM, Codified backend: `/srv/tlom2/api/.env`
- TLOM, Codified frontend: `/srv/tlom2/client/.env`
- Time v3 Astronomical Clock backend: `/srv/time-v3-astroclock4/api/.env`
- Time v3 Astronomical Clock frontend: `/srv/time-v3-astroclock4/client/.env`
- Keystone Tools: `/srv/keystone-tools/api/.env`
- Keystone Tools frontend: `/srv/keystone-tools/client/.env`
- AWIM: `/srv/time-v3-astroclock4/awim/.env`
- Chapeaux Fous environment: `/home/nate/code/agent-slayer/.env`
- Chapeaux Fous isolated Codex/ChatGPT state: `/home/nate/code/agent-slayer/data/codex-home/`
- Chapeaux Fous MCP OAuth state: `/home/nate/.local/state/agent-slayer/mcp-oauth/`
- OpenClaw config/auth: `/home/nate/.openclaw/openclaw.json` and `/home/nate/.openclaw/mcp-oauth/`
- WordPress:
  - `/srv/nathanruffing.com/wp-config.php`
  - `/srv/timev3technology.com/wp-config.php`

## Logs

- Nginx:
  - `/var/log/nginx/access.log`
  - `/var/log/nginx/error.log`
  - 2026-07-01 note: nginx access logs should include the request host for multi-site debugging, but this has not been applied yet.
    - Preferred approach: keep global nginx logs, but define one global `log_format` in `/etc/nginx/nginx.conf` inside the `http { ... }` block and use it for `/var/log/nginx/access.log`.
    - Minimum useful format should include `host="$host"`:
      ```nginx
      log_format main '$remote_addr - $remote_user [$time_local] '
                      'host="$host" '
                      '"$request" $status $body_bytes_sent '
                      '"$http_referer" "$http_user_agent"';

      access_log /var/log/nginx/access.log main;
      ```
    - Check for per-site overrides before assuming the global access log applies everywhere:
      ```bash
      sudo nginx -T | grep access_log
      ```
    - Apply with a config test and reload, not a full restart:
      ```bash
      sudo nginx -t
      sudo systemctl reload nginx
      ```
- PM2 app logs:
  - Canonical location: `/srv/logs/<pm2-app-name>.log`
  - Examples:
    - `/srv/logs/tlom-api.log`
    - `/srv/logs/tv3clock-api.log`
    - `/srv/logs/keystone-api.log`
  - Do not use PM2's default split logs as the normal debugging source. The default files under `~/.pm2/logs/` split stdout and stderr into separate dateless files, which makes event reconstruction painful.
  - PM2 app entries in `/srv/pm2/ecosystem.config.js` should set both streams to the same canonical file:
    ```js
    out_file: "/srv/logs/<pm2-app-name>.log",
    error_file: "/srv/logs/<pm2-app-name>.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    ```
  - After editing `/srv/pm2/ecosystem.config.js`, apply with:
    ```bash
    mkdir -p /srv/logs
    pm2 restart /srv/pm2/ecosystem.config.js --update-env
    pm2 save
    ```
  - To inspect a single app chronologically:
    ```bash
    tail -f /srv/logs/tlom-api.log
    ```
  - Historical split logs for the retired `*-viteserve` processes may remain
    under `/home/nate/.pm2/logs/`; they are not active application logs.
- systemd logs:
  - `journalctl -u awim.service`
  - `journalctl -u nginx`
  - `journalctl -u mariadb`
  - `journalctl --user -u agent-slayer.service` (run as `nate`)
  - `journalctl --user -u openclaw-gateway.service` (run as `nate`)

## Firewall

- UFW config: `/etc/ufw/`
- Allowed ports: 80, 443, SSH (22 or custom)

## Tailscale

Live configuration observed on 2026-08-02:

- Installed from Tailscale's stable Ubuntu Noble apt repository.
- Version: `1.98.10`
- System service: `tailscaled.service`, enabled and active
- Service state/socket: `/var/lib/tailscale/tailscaled.state` and `/run/tailscale/tailscaled.sock`
- UDP transport port setting: `41641` in `/etc/default/tailscaled`
- Tailnet: `timev3.com`, with MagicDNS enabled
- Node hostname: `hwsrv-1263600`
- MagicDNS name: `hwsrv-1263600.taile5d9ca.ts.net`
- Tailscale addresses: `100.74.107.121` and `fd7a:115c:a1e0::bc3a:6b7a`
- Node is not configured as an exit node.
- Persistent Serve route:

  ```text
  https://hwsrv-1263600.taile5d9ca.ts.net:8443 (tailnet only)
    / -> http://127.0.0.1:18789
  ```

- Tailscale Funnel is not enabled; the `:8443` route is tailnet-only.
- Tailscale terminates HTTPS and proxies to OpenClaw over loopback HTTP. Nginx and the public Let's Encrypt certificate are not part of this route.

Useful checks:

```bash
tailscale version
tailscale status
tailscale serve status
tailscale funnel status
systemctl status tailscaled.service
curl -I https://hwsrv-1263600.taile5d9ca.ts.net:8443/
```

Do not run `tailscale serve reset` or `tailscale down` during routine diagnosis; those mutate the persistent access configuration.

## Backups with HostWinds Cloud Backups

HostWinds uses an agent to manage certain settings within the server, including backups. The agent is evoked with  `hwagent` in the VPS CLI. `hwagent` uses restic under the hood and stores backups in HostWinds Object Storage. Use `hwagent --help` or `hwagent backups help` to view available commands, for example:

- Status: `sudo hwagent backups status`
- Run now: `sudo hwagent backups run`
- Configure schedule/retention: `sudo hwagent backups configure`
- Modify notifications: `sudo hwagent backups notify`
- Help/scope: `sudo hwagent --help` and `sudo hwagent backups --help`
- Restore is handled by HostWinds support. Provide the server ID
  (`hwsrv-1263600`) and choose the snapshot date (retention: 60 days).

You can view the underlying restic snapshots directly with the following commands from the server being backed up:

- Start a root shell: `sudo -i` (switches to root's login shell)
- Load restic env vars: `source /root/.restic_var`
- List snapshots: `restic snapshots`
- Generate a restore file: `restic restore <SNAPSHOT_ID> --target /tmp/restore` (notice this creates a file the same size as the entire used space on the disk, and can't be done to a remote location unless you 'mount' to some other location)
- Exit root shell: `exit` (or Ctrl-D)

## Notes

- One server = one point of failure. Use isolation (separate services/containers) to keep a single app from taking down everything else.
- For OCR or heavy CPU work, prefer strict timeouts and run only on explicit user action.

## AI Notes (context reset guide)

ChatGPT, If you're coming back later, have the user copy-paste this in first:

- Target VPS: `hwsrv-1263600` (Ubuntu 24.04). Apps live under `/srv`.
- Active repository roots include `tlom2`, `time-v3-astroclock4`, and
  `keystone-tools`. AWIM is now under `time-v3-astroclock4/awim` rather than a
  separate active checkout.
- WordPress sites: `/srv/nathanruffing.com` (DB `nathanruffing_wp`) and `/srv/timev3technology.com` (DB `timev3technology_wp`).
- WP DB dumps were imported into the target DBs by stripping `CREATE DATABASE`/`USE` from the dumps.
- WordPress table prefix currently `s4Q5wY_` (matches imported tables).
- PHP-FPM socket: `/run/php/php8.3-fpm.sock` (used in WP nginx vhosts).
- PM2 runs the TLOM, Time V3, and Keystone Node APIs from
  `/srv/pm2/ecosystem.config.js`. It does not serve their Vite build folders.
- Chapeaux Fous runs separately as Nate's `agent-slayer.service` user service
  from the last-confirmed production path `/home/nate/code/agent-slayer`, listens
  on `127.0.0.1:8787`, and is published by nginx at
  `https://chapeauxfous.com`. The development clone and GitHub repository use
  the `agent-chapeaux-fous` name.
- Chapeaux Fous browser OAuth depends on that public HTTPS origin; callbacks use
  `/api/integrations/<server-name>/oauth/callback`, while private tokens remain
  under `/home/nate/.local/state/agent-slayer/mcp-oauth/`.
- PM2 logs should be combined per app in `/srv/logs/<pm2-app-name>.log`; do not rely on the default split `~/.pm2/logs/*-out.log` and `*-error.log` files.
- AWIM runs via `awim.service` from
  `/srv/time-v3-astroclock4/awim/.venv` on port 5011.
- `timev3tech.com` redirects to `timev3technology.com` via nginx (`timev3tech.com.conf`).
- DNS: moved away from `ns1.nathanruffing.com` to HostWinds nameservers; wait for propagation before certbot.
- Chapeaux Fous has a dedicated Let’s Encrypt certificate under
  `/etc/letsencrypt/live/chapeauxfous.com/` for `chapeauxfous.com` and
  `www.chapeauxfous.com`, expiring 2026-11-22. The older sites continue to use
  the shared `timev3technology.com` certificate.
- Nginx serves the Time V3 and TLOM `client/dist` directories directly. Their
  retired PM2 frontend processes and unused frontend upstreams were removed on
  2026-08-18. Keystone has no public frontend route.
- HTTP redirects to HTTPS are enabled for the WP domains.
- Certbot auto-renew runs via systemd timer (about every 12 hours); use `sudo certbot renew --dry-run` to test.

# Commands Reference
Repo root:
```bash
cd /Users/nathanruffing/code/tlom2
```

Server deploy ref pattern:
```text
Use tags for immutable release points.
Examples:
- ios-build-29
- ios-build-30

On each server, do not stay in detached HEAD long-term.
Create a local branch from the deployed tag so the server has a named ref.
Examples:
- prod-build-29
- prod-build-30

Reason:
- tags are the permanent release record
- the local prod-build-* branch shows what that server is pinned to
- avoids detached HEAD confusion during rollbacks / inspection
```

Sync tags locally:
```bash
cd /Users/nathanruffing/code/tlom2
git fetch --tags
git tag --list
```

Sync tags on the production server checkout:
```bash
cd /srv/tlom2
git fetch --tags
git tag --list
```

Deploy a tagged release on the production server:
```bash
cd /srv/tlom2
git fetch --all --tags
git checkout ios-build-29
git switch -c prod-build-29
pm2 restart tlom-api --update-env
```

If already detached at the right tag, name the current checkout:
```bash
git switch -c prod-build-29
```

Roll back / switch to another tagged release:
```bash
cd /srv/tlom2
git fetch --all --tags
git checkout ios-build-30
git switch -c prod-build-30
pm2 restart tlom-api --update-env
```

Important deploy notes:
```text
- Keep api/.env outside git and restart PM2 with --update-env after env changes.
- Before treating a server branch as a real deploy state, run git status and make sure the worktree is clean.
- A branch does not disappear when merged unless it is explicitly deleted.
- If a prod-build-* branch already exists locally, either reuse it or rename/delete it intentionally before creating a new one.
```

Mobile app, local native iPhone build:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
npx expo run:ios --device
```

Mobile app, Expo dev server only:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
npx expo start --tunnel
```

Mobile app, typecheck:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
npx tsc --noEmit --pretty false
```

Build iOS app for TestFlight / App Store with EAS:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
eas build --platform ios --profile production
```

Submit built iOS app to Apple with EAS:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
eas submit --platform ios --latest --profile production
```

Important iOS submission note:
```text
mobile/eas.json uses:
- profile: production
- appVersionSource: remote
- autoIncrement: true

So each production EAS iOS build should auto-increment the Apple build number.
Must manually set the iOS version number because can't submit the same number after a version has been released and it doesn't auto-increment.
```

Android local native build:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
npx expo run:android
```

Android EAS build:
```bash
cd /Users/nathanruffing/code/tlom2/mobile
eas build --platform android --profile production
```

Web client, dev:
```bash
cd /Users/nathanruffing/code/tlom2/client
npm run dev
```

Web client, production build:
```bash
cd /Users/nathanruffing/code/tlom2/client
npm ci
npm run build
```

Web client, local preview of production build:
```bash
cd /Users/nathanruffing/code/tlom2/client
npm run preview
```

API, dev:
```bash
cd /Users/nathanruffing/code/tlom2/api
npm run dev
```

API, prod-style local start:
```bash
cd /Users/nathanruffing/code/tlom2/api
npm ci
npm start
```

API quick syntax checks:
```bash
cd /Users/nathanruffing/code/tlom2
node --check api/index.js
node --check api/database.js
node --check api/routes/mobileWorkRoutes.js
```

PM2, inspect current processes:
```bash
pm2 status
pm2 logs
```

Apple first-IAP reminder:
```text
First in-app purchases must be attached on the App Store Connect app-version page
before submitting that version to App Review.
```

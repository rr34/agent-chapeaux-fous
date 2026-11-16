# Production Server Reference (Ubuntu)

This is the current-state inventory for
`hwsrv-1263600.hostwindsdns.com`, last verified 2026-11-16. It is not a
migration transcript. Historical internal names may remain in service names,
database names, logs, and state paths for compatibility; they are not desired
public domains or deployment paths.

## Server identity

- Public IPv4: `23.254.144.125`
- Host: `hwsrv-1263600.hostwindsdns.com`
- Operating system: Ubuntu 24.04
- SSH: TCP 22
- Public web: nginx on TCP 80 and 443
- PHP-FPM: `/run/php/php8.3-fpm.sock`
- Nginx: `/etc/nginx/nginx.conf`
- PM2 ecosystem: `/srv/pm2/ecosystem.config.js`
- PM2 system unit: `/etc/systemd/system/pm2-nate.service`

## Canonical domains

| Domain | Purpose | Local target |
| --- | --- | --- |
| `timev3tech.com` | Canonical Time v3 WordPress site | `/srv/sites/timev3tech.com` |
| `www.timev3tech.com` | Redirect to canonical apex | `timev3tech.com` |
| `agent.timev3tech.com` | Time v3 Agent | `127.0.0.1:8787` |
| `auth.timev3tech.com` | Time v3 authentication | `127.0.0.1:8787` |
| `accounting.timev3tech.com` | Accounting web/API/MCP | static client plus `127.0.0.1:5004` |
| `awim.timev3tech.com` | AWIM API | port 5011 |
| `timev3.com` | Astronomical Clock | static client plus port 5001 |
| `mytlom.com` | TLOM | static client plus port 5002 |
| `nathanruffing.com` | Nathan Ruffing WordPress site | `/srv/nathanruffing.com` |
| `vincentruffing.com` | Vincent Ruffing static site | `/srv/vincentruffing.com/public` |
| `timev3technology.com` | Legacy redirect only | `timev3tech.com` |

The `www` variants of apex sites redirect to their apex. The
`timev3technology.com` apex and `www` remain registered and HTTPS-capable
only for the agreed redirect transition period.

### Retired domains

These names must not be used as application origins:

- `chapeauxfous.com`
- `www.chapeauxfous.com`
- `accounting.chapeauxfous.com`
- `agent.nathanruffing.com`

Their nginx vhosts were disabled on 2026-11-16 and archived under
`/etc/nginx/retired-sites/2026-11-16/`. Their obsolete certificate lineages
were removed. Their web DNS records should remain absent; confirm at the DNS
provider before assuming cached answers have expired.

## Production directories

```text
/srv/
  agent-timev3tech/                 # Time v3 Agent
    data/                            # isolated Codex/runtime state
    media/                           # recordings and artifacts
    public/                          # built browser client
    src/
    voice/
      .venv/                         # reproducible, path-dependent venv
      models/                        # retained speech models
  accounting-timev3tech/
    api/
    client/dist/
  sites/
    timev3tech.com/                  # canonical Time v3 WordPress root
  vincentruffing.com/
    public/index.html
  nathanruffing.com/
  time-v3-astroclock4/
    api/
    client/dist/
    awim/
  tlom2/
    api/
    client/dist/
  keystone-tools/                    # retirement deferred
  pm2/
    ecosystem.config.js
  logs/
  shared/
```

`tlom2`, `time-v3-astroclock4`, and `keystone-tools` remain active paths.
Their cleanup was deliberately deferred until the domain migration settles.
The old `/srv/awim/` checkout and pre-monorepo unit backup may still exist as
rollback artifacts; they are not active.

## Time v3 Agent

- Working directory: `/srv/agent-timev3tech`
- Listener: `127.0.0.1:8787`
- User service: `/home/nate/.config/systemd/user/agent-slayer.service`
- Environment: `/srv/agent-timev3tech/.env`
- Entry point: `/srv/agent-timev3tech/src/server.mjs`
- Voice environment: `/srv/agent-timev3tech/voice/.venv`
- Agent origin: `https://agent.timev3tech.com`
- Auth origin: `https://auth.timev3tech.com`

The installed service filename, package/log prefixes, stable references,
database names, and some state paths retain `agent-slayer` or
`chapeauxfous` identifiers for compatibility. The visible unit description
is `Time v3 Agent web, voice, Codex, and tool service`.

```bash
systemctl --user status agent-slayer.service --no-pager
journalctl --user -u agent-slayer.service -n 100 --no-pager
curl -sS https://agent.timev3tech.com/health
cd /srv/agent-timev3tech && npm run db:verify
```

The voice virtualenv is not relocatable. Recreate it after a deployment-path
or Python-version change without deleting `voice/models`:

```bash
cd /srv/agent-timev3tech
python3 -m venv --clear voice/.venv
voice/.venv/bin/pip install -r voice/requirements.txt
```

## PM2 applications

PM2 manages backend APIs only. Nginx serves built frontend directories.

| PM2 name | Entry point | Port |
| --- | --- | --- |
| `tlom-api` | `/srv/tlom2/api/index.js` | 5002 |
| `tv3clock-api` | `/srv/time-v3-astroclock4/api/index.js` | 5001 |
| `accounting-api` | `/srv/accounting-timev3tech/api/src/index.js` | 5004 |
| `keystone-api` | `/srv/keystone-tools/api/index.js` | 5003 |

Combined PM2 logs are under `/srv/logs/<pm2-app-name>.log`.

## AWIM

- Working directory: `/srv/time-v3-astroclock4/awim`
- Environment: `/srv/time-v3-astroclock4/awim/.env`
- Virtualenv: `/srv/time-v3-astroclock4/awim/.venv`
- Unit: `/etc/systemd/system/awim.service`
- Listener: port 5011
- Domain: `https://awim.timev3tech.com`

Nightly cache units:

- `/etc/systemd/system/awim-nightly-cache.service`
- `/etc/systemd/system/awim-nightly-cache.timer`

The intended schedule is daily at `08:00 UTC`, deliberately fixed UTC-8
midnight rather than daylight-saving local time. Cache logs are under
`/srv/time-v3-astroclock4/awim/cache_logs/`.

## Listener inventory

This state was observed on 2026-11-16. Hardening was inspected but deliberately
deferred to avoid introducing unrelated risk immediately after migration.

| Port | Bind observed | Owner | Intended access |
| --- | --- | --- | --- |
| 22 | `0.0.0.0`, `[::]` | SSH | Public administration |
| 80 | `0.0.0.0`, `[::]` | nginx | Public HTTP |
| 443 | `0.0.0.0` | nginx | Public HTTPS |
| 5001 | `0.0.0.0` | Time v3 API | Normally through nginx |
| 5002 | `0.0.0.0` | TLOM API | Normally through nginx |
| 5003 | all interfaces | Keystone API | No public frontend; cleanup deferred |
| 5004 | `127.0.0.1` | Accounting API | Nginx only |
| 5011 | `0.0.0.0` | AWIM | Normally through nginx |
| 3306 | `0.0.0.0` | MariaDB | All observed clients were local |
| 8787 | `127.0.0.1` | Time v3 Agent | Nginx only |
| 8443 | Tailscale addresses | Tailscale Serve | Tailnet only |

UFW was not installed when checked (`ufw: command not found`). Do not claim
that UFW protects application or database ports. Installing and enabling a
host firewall is a separate change requiring explicit SSH, Tailscale, provider
firewall, and recovery planning.

MariaDB had only loopback client connections when inspected. The account
`nate@%` still existed. Changing it requires a separate grants/workflow audit.

## Nginx

Active vhosts:

```text
/etc/nginx/sites-available/accounting.timev3tech.com.conf
/etc/nginx/sites-available/agent.timev3tech.com.conf
/etc/nginx/sites-available/auth.timev3tech.com.conf
/etc/nginx/sites-available/awim.conf
/etc/nginx/sites-available/mytlom.com.conf
/etc/nginx/sites-available/nathanruffing.com.conf
/etc/nginx/sites-available/timev3.com.conf
/etc/nginx/sites-available/timev3tech.com.conf
/etc/nginx/sites-available/timev3technology.com.conf
/etc/nginx/sites-available/vincentruffing.com.conf
```

Matching symlinks are under `/etc/nginx/sites-enabled/`.

Routing summary:

```text
agent.timev3tech.com/* and auth.timev3tech.com/*
  -> http://127.0.0.1:8787

accounting.timev3tech.com/
  -> /srv/accounting-timev3tech/client/dist
accounting.timev3tech.com/api/*, /mcp, and /mcp/*
  -> http://127.0.0.1:5004

timev3tech.com/*
  -> /srv/sites/timev3tech.com via PHP-FPM
timev3technology.com/*
  -> permanent redirect to timev3tech.com

timev3.com/
  -> /srv/time-v3-astroclock4/client/dist
timev3.com/api/*
  -> port 5001

mytlom.com/
  -> /srv/tlom2/client/dist
mytlom.com API, discovery, and OAuth routes
  -> port 5002

awim.timev3tech.com/*
  -> port 5011
```

Accounting's exact `/mcp` route and `/mcp/` prefix route must both forward
`Authorization` and disable response buffering. The prefix also disables
request buffering and permits at least 2 MiB bodies. Unauthenticated POSTs to
`/mcp` and `/mcp/artifacts` should return JSON HTTP 401.

Do not add an nginx wildcard IPv6 listener on port 443. Tailscale owns the
tailnet IPv6 listener there.

## TLS certificates

Each retained service has a purpose-specific Let's Encrypt lineage:

| Lineage | Names |
| --- | --- |
| `accounting.timev3tech.com` | accounting hostname |
| `agent.timev3tech.com` | Agent hostname |
| `auth.timev3tech.com` | Auth hostname |
| `awim.timev3tech.com` | AWIM hostname |
| `mytlom.com` | apex and `www` |
| `nathanruffing.com` | apex and `www` |
| `timev3.com` | apex and `www` |
| `timev3tech.com` | apex and `www` |
| `timev3technology.com` | legacy redirect apex and `www` only |
| `vincentruffing.com` | apex and `www` |

Files are under `/etc/letsencrypt/live/<lineage>/`. On 2026-11-16, the Agent
certificate expired on 2027-01-05 and the newly issued lineages expired on
2027-02-14. Recorded dates are not proof that renewal remains healthy.

```bash
sudo certbot certificates
sudo certbot renew --dry-run
sudo nginx -t
```

## WordPress

### Time v3 Tech

- Canonical domain: `https://timev3tech.com`
- Root: `/srv/sites/timev3tech.com`
- Configuration: `/srv/sites/timev3tech.com/wp-config.php`
- Database: `timev3technology_wp` (historical name retained)
- Database user: `timev3technology_wp_user@localhost`
- Table prefix: `s4Q5wY_`

The domain/filesystem migration completed on 2026-11-16. Online payment use was
disabled. Historical WooCommerce product and order data was intentionally
retained while products are converted to ordinary posts/pages. Do not enable a
website gateway; generic invoicing belongs to Time v3 Agent.

Before deleting WooCommerce data, confirm product conversion and take a current
database export.

### Nathan Ruffing

- Domain: `https://nathanruffing.com`
- Root: `/srv/nathanruffing.com`
- Configuration: `/srv/nathanruffing.com/wp-config.php`
- Database: `nathanruffing_wp`
- Database user: `nathanruffing_wp_user@localhost`

Uploads remain under each site's `wp-content/uploads/`.

## MariaDB

- Main configuration: `/etc/mysql/my.cnf`
- Server configuration: `/etc/mysql/mariadb.conf.d/50-server.cnf`
- Data: `/var/lib/mysql/`
- Socket: `/var/run/mysqld/mysqld.sock`
- Bind observed: `0.0.0.0:3306`

Known databases include `nathanruffing_wp`, `timev3technology_wp`, `tlom`,
`awim`, `keystonedata`, and Time v3 Agent's configured application and
identity databases. Agent verification reported application schema 74 and
database name `chapeauxfous` on 2026-11-16.

Do not apply live migrations automatically. Nate runs reviewed MariaDB
migrations manually after a current backup. Run read-only verification before
and after database-dependent changes.

## Secrets, state, and durable files

```text
/srv/agent-timev3tech/.env
/srv/agent-timev3tech/data/codex-home/
/srv/agent-timev3tech/media/
/srv/accounting-timev3tech/api/.env
/srv/accounting-timev3tech/client/.env
/srv/tlom2/api/.env
/srv/tlom2/client/.env
/srv/time-v3-astroclock4/api/.env
/srv/time-v3-astroclock4/client/.env
/srv/time-v3-astroclock4/awim/.env
/srv/keystone-tools/api/.env
/srv/keystone-tools/client/.env
/home/nate/.local/state/agent-slayer/mcp-oauth/
/home/nate/.openclaw/
```

Durable user files include:

- Agent media: `/srv/agent-timev3tech/media/`
- Accounting artifacts: `/srv/accounting-timev3tech/api/data/artifacts/`
- Accounting evidence: `/srv/accounting-timev3tech/api/data/evidence/`
- TLOM uploads: `/srv/tlom2/api/uploads/`
- Clock images: `/srv/time-v3-astroclock4/api/public/clockimages/`
- WordPress uploads: each site's `wp-content/uploads/`

Never put environment files, keys, exports, tokens, or credentials in Git.

## OpenClaw and Tailscale

OpenClaw is user-scoped and not behind nginx:

```text
/home/nate/.npm-global/lib/node_modules/openclaw/
/home/nate/.openclaw/
/home/nate/.config/systemd/user/openclaw-gateway.service
/home/nate/code/slayer-agent/
```

Its tailnet-only route is:

```text
https://hwsrv-1263600.taile5d9ca.ts.net:8443
  -> Tailscale Serve
  -> http://127.0.0.1:18789
```

Do not run `tailscale serve reset` or `tailscale down` during routine checks.

## Logs and backups

- Nginx: `/var/log/nginx/`
- PM2: `/srv/logs/<pm2-app-name>.log`
- Agent: `journalctl --user -u agent-slayer.service`
- AWIM: `journalctl -u awim.service`
- MariaDB: `journalctl -u mariadb`
- OpenClaw: `journalctl --user -u openclaw-gateway.service`

HostWinds Cloud Backups use `hwagent` with restic-backed object storage.
Restores are coordinated through HostWinds support for server
`hwsrv-1263600`. The recorded retention was 60 days; verify provider policy.

The sensitive manual WordPress export from the domain migration is under
`/srv/backups/manual/`.

## Baseline verification

```bash
sudo nginx -t
sudo certbot certificates
pm2 status
systemctl --user status agent-slayer.service --no-pager
systemctl status awim.service --no-pager
sudo ss -ltnp
```

Public checks:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://timev3tech.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://agent.timev3tech.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://auth.timev3tech.com/login
curl -sS -o /dev/null -w '%{http_code}\n' https://accounting.timev3tech.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://timev3.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://mytlom.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://nathanruffing.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://vincentruffing.com/
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  https://timev3technology.com/
```

Expected behavior includes 200 for websites, an auth response or redirect for
Agent, 200 for Auth login, and a redirect from `timev3technology.com` to
`timev3tech.com`. AWIM may return 404 at `/` because it is an API.

## Future hardening summary

Treat hardening as its own scheduled maintenance project. Take a current backup,
keep a second SSH session open, confirm HostWinds console or recovery access,
and change one layer at a time. Re-run the baseline checks after every layer
instead of combining firewall, listener, database-account, and SSH changes into
one cutover.

Recommended order:

1. **Measure external exposure.** Check the HostWinds network-firewall policy
   and scan the public IP from outside the server for TCP 22, 80, 443, 3306,
   5001, 5002, 5003, and 5011. Compare that result with `sudo ss -ltnp`.
2. **Bind nginx-only applications to loopback.** After checking each
   application's configuration and dependencies, change ports 5001, 5002,
   5003, and 5011 to `127.0.0.1` one service at a time. Restart only that
   service, test its nginx route, and restore its saved configuration if the
   check fails.
3. **Restrict MariaDB.** Confirm all clients use localhost or an SSH tunnel,
   back up `50-server.cnf`, bind MariaDB to `127.0.0.1`, restart it, and run
   every affected application's read-only database verification. Separately
   audit the grants and purpose of `nate@%` before replacing or dropping it.
4. **Add a host firewall only in a dedicated window.** Before enabling UFW,
   allow the actual SSH service and public HTTP/HTTPS, account explicitly for
   Tailscale, and record the rollback command. Enable it while a second SSH
   session and provider console are available. Verify public sites, SSH,
   tailnet access, Tailscale Serve, DNS resolution, and certificate renewal.
5. **Harden SSH separately.** Verify key-based access and recovery first, then
   review root login, password authentication, idle sessions, allowed users,
   and rate limiting. Test a new login before closing the recovery session.
6. **Retire unused services.** Archive required Keystone data and configuration,
   revoke its credentials, stop and remove its PM2 entry, confirm port 5003 is
   closed, and only then consider deleting its files, database, or database
   account.
7. **Verify recurring safeguards.** Run a Certbot renewal dry run, inspect
   backup status and retention, test a documented restore procedure, verify
   service auto-start after reboot, and review logs for repeated authentication
   failures or unexpected public traffic.

For every hardening change, record the previous value, exact changed file,
service restart, verification result, and rollback action. Do not remove a
working recovery path during the same window in which its replacement is first
introduced.

## Deliberately deferred work

- Listener/firewall hardening for ports 5001, 5002, 5003, 5011, and 3306.
- Audit and replacement of `nate@%`.
- Keystone retirement.
- Renaming `/srv/tlom2` and `/srv/time-v3-astroclock4`.
- Removing inactive AWIM rollback assets.
- Final WooCommerce removal after product conversion.
- Final retirement of the `timev3technology.com` redirect.

These are known follow-up items, not claims that the server already implements
them.

# Agent Slayer

Agent Slayer is a small, inspectable model-and-tools application. It is not an
agent framework and has no plugin host. The request compiler, tool registry,
SQLite ledger, and web client are provider-neutral. Codex App Server is the
initial model transport because it can use the user's ChatGPT subscription instead
of separately billed API-key requests.

The complete request path is:

```text
web or voice input
  -> bounded context from SQLite
  -> one model turn containing the exact callable-tool schemas
  -> local or MCP tool execution
  -> tool result returned to that same model exchange
  -> final response
```

Every boundary is recorded in `activity_events` and shown in the web trace:
user request, context, tools, exact model request, exact model response, tool
call, tool result, and final answer.

## First local run

Requirements: Node.js 22.5 or newer, Codex CLI, a ChatGPT account with Codex
access, and an existing Slayer database snapshot.

```bash
cp .env.example .env
# Edit .env.
npm run codex:login
npm run codex:status
cp /path/to/latest-snapshot.sqlite data/agent.sqlite
npm install
npm run schema:migrate
npm run db:verify
npm test
npm start
```

Open `http://127.0.0.1:8787`. The browser asks for `SLAYER_ACCESS_TOKEN` and
stores it only in that browser. The same client includes the Agent request
feed, the existing calendar, and the grouped to-do list.

`.env` intentionally lives beside `.env.example` in the repository root. It is
ignored by Git and loaded by the process before configuration is evaluated.

## Codex connection

The runtime starts `codex app-server` over local stdio and requires its active
account to be `chatgpt`. API-key authentication is deliberately rejected. Run
`npm run codex:login` as the same Unix user that runs Agent Slayer. This uses a
dedicated, gitignored `data/codex-home` so Slayer cannot inherit MCP servers,
plugins, skills, instructions, or other configuration from normal Codex use.
If `codex` is not on the service PATH, set `SLAYER_CODEX_COMMAND` to the
executable's absolute path before running the login script.
`SLAYER_CODEX_REQUIRED_VERSION` makes health fail visibly when the executable
does not match the App Server version tested by this release.

Each request gets a fresh ephemeral Codex thread. Agent Slayer replaces the
base instructions, supplies its bounded context and dynamic tools, executes
tool calls itself, and owns the durable SQLite ledger. App Server's unrelated
agent capabilities are disabled at startup. Every turn is also read-only,
network-disabled, and rooted in the empty
`~/.local/state/agent-slayer/codex-workspace` directory outside every source
repository. If
Codex nevertheless emits a shell, file, web, app, or subagent item, Agent Slayer
interrupts and rejects the turn instead of accepting its answer.
Startup also reads the effective Codex configuration and fails health if any
MCP server, plugin, or subagent configuration leaked into the isolated home.

The default model is `gpt-5.6-terra`; change `SLAYER_MODEL` explicitly if
desired. Dynamic tools are an experimental Codex App Server feature, so deploy
the configured Codex CLI version and treat version changes as application
upgrades: update the required version, regenerate/inspect its protocol schema,
run the test suite, and complete an authenticated tool-loop probe.

## Model transport boundary

`SlayerRuntime` depends only on the transport contract in
`src/model-transport.mjs`: identity, lifecycle, health, exact request
description, and `runTurn`. Tool definitions and tool results stay in Slayer's
provider-neutral format. A transport adapter performs protocol translation and
returns a normalized final response, usage report, and provider trace.

To support another model runtime, add one adapter implementing that contract,
register its configuration in `createModelTransport`, and select it with
`SLAYER_MODEL_TRANSPORT`. No context, SQLite, tool, queue, ledger, HTTP, or web
client code should change. This is an explicit application boundary, not a
plugin system.

## Subscription usage

Agent Slayer reads Codex's ChatGPT rate-limit buckets before and after each
request. The header shows the most constrained remaining percentage and reset
time. Each completed request records token usage, quota change, and remaining
capacity. Percentage changes can be zero for small calls because the service
reports integer percentages and can update asynchronously; token usage remains
visible even then.

## Tools

Local tools are ordinary JavaScript functions:

- `todo_list`, `todo_add`, and `todo_update` provide the native personal to-do
  path without requiring the model to invent SQL.
- `log_add`, `log_import`, `log_list`, `tracker_list`, and `tracker_update`
  provide the native grouped personal-log path. Each entry keeps complete
  natural-language content with optional numeric and unit projections for
  calculation and trends. Bounded imports use generic source and external IDs
  for safe replay without source-specific application code.
- `profile_fact_list`, `profile_fact_set`, and `profile_fact_delete` manage the
  durable user facts selected as relevant to each first model request.
- `database_schema`, `database_read`, and `database_write` expose bounded,
  structured access to the existing SQLite database. Ledger and schema tables
  are protected from model writes. Each operation returns the exact projection
  compiled from the tracked schema-semantic form.
- `history_recent` and `history_search` read the application-owned exchange
  history.

`config/profile-fact-questions.json` is the versioned catalog of standard
secretary question families. It defines a broad repeatable fact type, the exact
question, when it becomes relevant, and matching keyphrases. A deterministic
pre-model filter supplies at most three relevant types and all active rows of
those types. Each row has a stable ID and self-contained natural-language text
identifying its person or item. The model replaces an exact row by ID when that
same real-world fact changes, or adds another row for a different person or
item. No extra model call is made, and no profile section is sent when no
standard type is relevant. Answers live only in SQLite; the repository contains
no user's profile values.

Remote MCP tools are discovered by Agent Slayer from
`config/mcp-servers.json` at process startup. Their exact discovered schemas are
placed beside the local tools in the first model request, then translated by
the active model transport. Codex's own MCP, app, plugin, shell, and filesystem
facilities are not the application tool path. Missing or failed integrations
are visible in `/health`; they are never silently represented as available.

MCP integrations with an `oauth` block use the standard MCP authorization-code
flow with OAuth discovery, dynamic client registration, PKCE, and refresh
tokens. Set `SLAYER_PUBLIC_URL` to the origin where a browser can reach Agent
Slayer, start the service, then use that integration's **Connect** button in the
web client's provider-neutral **Integrations** manager. Each configured OAuth
integration has its own status, action, and callback:

```text
<SLAYER_PUBLIC_URL>/api/integrations/<server-name>/oauth/callback
```

OAuth client registrations and tokens are stored as mode `0600` files under
`~/.local/state/agent-slayer/mcp-oauth` by default. The directory is mode
`0700`. Set `SLAYER_MCP_OAUTH_ROOT` to override it. Nutrition selects this
generic OAuth path and does not use a `NUTRITION_ACCESS_TOKEN`; connect it in the
web interface and sign in to Nutrition there.

**Disconnect** immediately closes the MCP client, removes that provider's tools
from the callable registry, and deletes Agent Slayer's local OAuth registration
and tokens. This is intentionally described as a local disconnect: it does not
claim that the remote provider revoked its own grant when no revocation endpoint
is available.

TLOM currently uses its separately issued `TLOM_ACCESS_TOKEN` and is marked as
a required integration. Until that connection succeeds, health is not ready
and model requests are rejected with the integration status instead of falling
back to unrelated local database tools.

## Database and schema changes

No database is committed. Put the latest consistent SQLite snapshot at
`data/agent.sqlite`, run `npm run schema:migrate`, then run `npm run db:verify`.
The migration runner creates a timestamped backup before applying explicitly
approved migrations from `db/migrations.sql`. It applies each migration in a
transaction, checks SQLite integrity, and synchronizes the mechanical portion
of `db/schema-semantics.json` while preserving its human-authored meanings.

`profile_facts` is the authoritative store for durable user facts. Multiple
active rows may share a broad type such as `vehicle`; their text identifies the
person or item. Replacement and deletion target one stable row ID and archive
that row so prior versions remain observable without entering future model
context. Do not seed personal facts in a tracked migration: populate each
deployment through the profile-fact tools.

The schema semantic compiler explains selected database objects and fields; it
does not read rows, authorize access, choose tools, or execute SQL. The current
runtime uses it on structured database tool operations. It does not perform
pre-model enrichment or change which tools are supplied.

## Voice transcription

The web client records audio and sends it to the same FIFO request queue. To
enable local transcription:

```bash
python3 -m venv voice/.venv
voice/.venv/bin/pip install -r voice/requirements.txt
```

The original recording is stored before transcription begins.

## Deployment

`systemd/agent-slayer.service.example` is a reference only. Update its paths,
copy it into the user systemd directory, and enable it during the separate
deployment step.

## Read-only live inspection

Production may define `SLAYER_INSPECT_TOKEN` as a second, independently random
credential. It is accepted only for request listing, exact traces, schema
inspection, and bounded structured database reads. It cannot submit requests or
voice, write database rows, or start integration authorization.

In a trusted development checkout, copy `config/live-inspect.env.example` to
the gitignored `.env.live-inspect`, set its mode to `0600`, then set the live
HTTPS origin and matching inspection token. The CLI refuses a credential file
that is accessible to group or other users. Common reads are:

```bash
npm run live:inspect -- trace 6bce8f9c
npm run live:inspect -- requests 20
npm run live:inspect -- schema activity_events
npm run live:inspect -- read activity_events '{"turn_id":"full-request-id"}' 50
```

The CLI never prints its bearer token. Its database command accepts only an
existing object name, equality filters, and a maximum of 200 rows; raw SQL is
not part of the interface.

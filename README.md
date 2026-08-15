# Agent Slayer

Agent Slayer is a small, inspectable model-and-tools application. It is not an
agent framework and has no plugin host. The request compiler, tool registry,
SQLite ledger, and web client are provider-neutral. Codex App Server is the
initial model transport because it can use Nate's ChatGPT subscription instead
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
npm run db:verify
npm test
npm start
```

Open `http://127.0.0.1:8787`. The browser asks for `SLAYER_ACCESS_TOKEN` and
stores it only in that browser.

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
network-disabled, and rooted in the empty `data/codex-workspace` directory. If
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

- `todo_list`, `todo_add`, and `todo_update` provide the native personal todo
  path without requiring the model to invent SQL.
- `database_schema`, `database_read`, and `database_write` expose bounded,
  structured access to the existing SQLite database. Ledger and schema tables
  are protected from model writes.
- `history_recent` and `history_search` read the application-owned exchange
  history.

Remote MCP tools are discovered by Agent Slayer from
`config/mcp-servers.json` at process startup. Their exact discovered schemas are
placed beside the local tools in the first model request, then translated by
the active model transport. Codex's own MCP, app, plugin, shell, and filesystem
facilities are not the application tool path. Missing or failed integrations
are visible in `/health`; they are never silently represented as available.

`TLOM_ACCESS_TOKEN` is intentionally a direct integration credential. OAuth
bootstrap and refresh can be added inside the TLOM connection without changing
the model loop.

## Database transition

No database is committed. Put the latest consistent SQLite snapshot at
`data/agent.sqlite` and run `npm run db:verify`. The first runtime uses the
existing domain tables and the neutral `activity_events` ledger. Legacy columns
that are not needed are ignored. A later database migration can remove them
without coupling that work to this repository transition.

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

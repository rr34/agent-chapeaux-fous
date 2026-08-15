# Agent Slayer

Agent Slayer is a small, inspectable application that gives a language model a
set of concrete tools. It is not an agent framework and has no plugin host.

The complete request path is:

```text
web or voice input
  -> bounded context from SQLite
  -> one Responses API request containing the exact tool schemas
  -> local or MCP tool execution
  -> tool result returned to the same model exchange
  -> final response
```

Every boundary is recorded in `activity_events` and shown in the web trace:
user request, context, tools, exact model request, exact model response, tool
call, tool result, and final answer.

## First local run

Requirements: Node.js 22.5 or newer and an existing Slayer database snapshot.

```bash
cp .env.example .env
# Edit .env.
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

## Model connection

The runtime calls the OpenAI Responses API directly with `OPENAI_API_KEY`. The
default model is `gpt-5.6-terra`; change `SLAYER_MODEL` explicitly if desired.
No conversation is delegated to another runtime. `store: false` is sent on
every model request, and the SQLite ledger is the application-owned record.

## Tools

Local tools are ordinary JavaScript functions:

- `todo_list`, `todo_add`, and `todo_update` provide the native personal todo
  path without requiring the model to invent SQL.
- `database_schema`, `database_read`, and `database_write` expose bounded,
  structured access to the existing SQLite database. Ledger and schema tables
  are protected from model writes.
- `history_recent` and `history_search` read the application-owned exchange
  history.

Remote MCP tools are discovered from `config/mcp-servers.json` at process
startup. The exact discovered schemas are placed beside the local tools in the
first model request. Missing or failed integrations are visible in `/health`;
they are never silently represented as available.

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

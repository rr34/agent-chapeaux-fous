# Agent Slayer

Agent Slayer is a small, inspectable model-and-tools application. It is not an
agent framework and has no plugin host. The request compiler, tool registry,
SQLite ledger, and web client are provider-neutral. Codex App Server is the
initial model transport because it can use the user's ChatGPT subscription instead
of separately billed API-key requests.

The complete request path is:

```text
web or voice input
  -> deterministic capability selection
  -> bounded context from SQLite plus selected capability guidance
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
feed, the calendar, the grouped to-do list, a searchable contacts address book,
and grouped personal logs with native entry creation. Contacts support people,
organizations, and services with tags, birthday, notes, and stacked contact
methods. Possible duplicates are reviewed and merged explicitly; source records
remain as inactive history so existing references are preserved. Stored birthdays
continue to appear on the calendar. Agent requests may include one bounded CSV,
vCard/VCF, or plain-text attachment decoded as UTF-8, UTF-16, or Windows-1252.
Small files appear in full in visible model context;
large files contribute a bounded preview while native file tools can process the verified
full attachment. A task's Schedule
button opens the calendar in day-pick mode; selecting a day writes the task's
scheduled date as an all-day task. Timed tasks remain available through the
to-do editor and agent tools.

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

Requests continue on one persistent Codex thread while the compiled callable
capabilities stay the same, or until the user starts a new conversation. Agent
Slayer resumes that thread with current replacement base instructions and
bounded context, executes tool calls itself, and owns the durable SQLite ledger.
A changed callable-tool schema automatically starts a new thread so the model
never receives stale tool definitions; bounded recent exchanges are injected
when that capability change starts the replacement thread. App Server's
unrelated agent capabilities are disabled at startup. Every turn is also read-only,
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

## Request and context compilation

Agent Slayer owns a deterministic request compiler in application code. It
pairs each local domain's exact tool schemas with versioned capability guidance
from `config/instructions/`; `config/system-prompt.md` contains only universal
behavior. Routing considers the exact request, verified attachment metadata and
preview, recent exchange text for short confirmations, and the capability set
of the active model conversation. Recognized requests receive only the relevant
bundles. An unclear request or unknown attachment conservatively receives every
currently available tool and every applicable instruction fragment, preserving
the broad fallback behavior. A newly registered local tool that has not yet been
assigned to a hard-coded capability also forces that full fallback, so additions
cannot silently disappear from model access.

The selected tool list is enforcement, not a hint: a model call outside that
request's callable set is rejected before the application function can run.
The trace records the selection reasons, selected versus available counts,
serialized schema bytes, instruction character counts, and whether schemas were
sent with a new thread or retained on a resumed thread.

## Subscription usage

Agent Slayer reads Codex's ChatGPT rate-limit buckets before and after each
request. The header shows the most constrained remaining percentage and reset
time. Each completed request records token usage, quota change, and remaining
capacity. Percentage changes can be zero for small calls because the service
reports integer percentages and can update asynchronously; token usage remains
visible even then.

## Tools

Local tools are ordinary JavaScript functions:

Native database-backed tool results preserve SQLite column names and attach the
schema-semantic compiler's operation-specific projection. The tracked semantic
form is therefore the single human-authored source for explaining stored fields
to the model; UI transport objects remain an independent browser concern.

- `web_page_read` fetches one explicit HTTP(S) URL and returns bounded extracted
  text, metadata, and links so the model can follow pagination or directly
  related pages. It is not a search tool. Each redirect is checked, private and
  local network targets are rejected, DNS is pinned for the request, and binary
  responses are not returned to the model.
- `todo_group_list`, `todo_group_create`, `todo_group_rename`,
  `todo_group_archive`, `todo_list`, `todo_add`, `todo_recurrence_set`, and
  `todo_update` provide the native personal to-do path without
  requiring the model to invent SQL. The agent inspects existing groups before
  assigning an otherwise ungrouped task; Inbox is the catchall when no group is
  a clear match. Group archival fails while active tasks remain and preserves
  the group on terminal task history. Recurrence is supplied as structured,
  human concepts and stored internally as RRULE.
- `calendar_event_search`, `calendar_event_list`, `calendar_event_add`, `calendar_event_update`, and
  `calendar_event_recurrence_set` provide the native model-facing calendar
  path. Event records retain exact `calendar_events` column names and compiler
  semantics, while range reads identify expanded recurrence and birthday
  instances as computed occurrences. All-day scheduling is explicit and
  recurrence is supplied as structured concepts rather than raw RRULE. The
  product-facing event states are Active and Archived; iCalendar status values
  remain an internal storage and interoperability detail. Search matches every
  supplied term across stored event titles, descriptions, and locations, with
  archived events available only when requested. A saved event can
  create one standardized invitation email draft addressed to active contacts
  through the configured JMAP mail account. This action creates a draft only:
  it never sends the message, writes to a remote calendar, or changes the local
  calendar's authority. Every displayed agenda event also has a phone-friendly
  copy action for sharing its saved details through another app.
- `log_add`, `log_import`, `log_list`, `tracker_list`, and `tracker_update`
  provide the native grouped personal-log path. Each entry keeps complete
  natural-language content with optional numeric and unit projections for
  calculation and trends. Bounded imports use generic source and external IDs
  for safe replay without source-specific application code.
- `contact_file_import` parses a complete attached CSV or vCard/VCF directly,
  importing up to 10,000 contacts in one transaction without asking the model
  to reproduce every row. The model maps CSV headers from a bounded preview;
  the application processes the full verified file. `contact_import` remains
  available for up to 200 contacts supplied as structured data without a file.
  Stable source IDs make replays idempotent, and each contact can retain multiple
  methods, notes, and reusable overlapping tags. `contact_duplicate_list` gives
  the model the same candidate groups shown by the Contacts review UI. Exact
  normalized names are candidates directly; different full names require both
  a shared normalized name word and an exact email or phone. Partial-name
  candidates remain review-only. The Contacts view uses row checkboxes in place
  of initials avatars for atomic bulk tag addition and permanent deletion. Tags
  can be renamed across all assigned contacts from either the UI or the
  `contact_tag_rename` agent tool; an existing destination tag is merged safely.
  `contact_lookup_batch` resolves up to 500 names at once and
  `contact_tag_add_batch` applies one tag to as many as 10,000 contacts in one
  atomic, replay-safe call rather than consuming one model tool call per row.
  `contact_merge` performs one version-checked merge, while
  `contact_merge_batch` atomically applies up to 100 AI-reviewed merge groups in
  one call. Both combine contact details while retaining source records as
  inactive history. Compact duplicate pages let one agent request review and
  resolve hundreds of groups without spending one tool call per merge.
  `contact_dedupe_clear` handles up to 500 conservative source-aware groups per
  call when names match and exact email or phone evidence connects records from
  distinct imports; ambiguous groups remain queued for AI judgment.
- `profile_fact_list`, `profile_fact_set`, and `profile_fact_delete` manage the
  durable user facts selected as relevant to each first model request.
- `database_schema`, `database_read`, and `database_write` expose bounded,
  structured access to the existing SQLite database. Ledger and schema tables
  are protected from model writes. Each operation returns the exact projection
  compiled from the tracked schema-semantic form.
- `history_recent`, `history_search`, and `history_range` read the
  application-owned exchange history. Date-range retrieval returns paired
  requests and responses, supports relative local periods through explicit UTC
  boundaries, and can apply a topical term filter across both sides of each
  exchange in the same lookup.
- `email_account_list`, `email_mailbox_list`, `email_identity_list`,
  `email_search`, `email_get`, `email_thread_get`, `email_changes`,
  `email_update`, `email_bulk_update`, `email_cleanup_preview`,
  `email_cleanup_apply`, `email_cleanup_receipt_list`, `email_draft_create`, `email_send`,
  `email_submission_get`, and `email_attachment_get` provide a native JMAP mail
  path. Compact searches keep Inbox triage bounded. Cleanup previews retain an
  exact candidate set for 30 minutes; applying one uses its Email state token to
  reject stale writes and moves the reviewed set to Trash or Archive in one
  recoverable operation. Reads go to the live mail store rather than a SQLite
  cache. Draft creation never implies delivery; `email_send` is a separate
  externally effective operation and moves successful submissions from Drafts
  to Sent. Durable cleanup receipts reconstruct exact affected messages from
  successful tool calls even when the original final response was interrupted
  or incomplete.

## JMAP email

Agent Slayer discovers a standard JMAP Session resource at startup and only
registers email tools after authenticated discovery confirms both core and mail
capabilities. Set these values in `.env`:

```text
SLAYER_JMAP_SESSION_URL=https://api.fastmail.com/jmap/session
SLAYER_JMAP_ACCESS_TOKEN=<JMAP API token>
SLAYER_JMAP_REQUIRED=true
```

Fastmail API tokens are created under **Settings → Privacy & Security → Manage
API tokens**. Other conforming providers may use a different session URL. Set
`SLAYER_JMAP_ACCOUNT_ID` only when the session exposes multiple accounts and
the advertised primary mail account is not the intended one. The token remains
server-side and is excluded from health, traces, tool schemas, and tool results.

JMAP is the email authority: mailbox membership, keywords, threads, message
bodies, attachment blobs, identities, and submission state are read live.
`email_changes` exposes standard state-token pagination for efficient future
mirroring without making a local cache authoritative. Email does not use the
MCP configuration or Codex's isolated network boundary; the named local tool
function performs each JMAP request and returns its result to the same model
exchange.

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
eligible for deterministic request selection beside the local tools. Every
selected schema is placed in the first model request for its conversation, then
translated by the active model transport. Codex's own MCP, app, plugin, shell, and filesystem
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

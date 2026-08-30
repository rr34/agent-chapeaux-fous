# Chapeaux Fous

Chapeaux Fous is a small, inspectable model-and-tools application. The internal
repository and compatibility identifiers still use `agent-slayer`. It is not an
agent framework and has no plugin host. The request compiler, tool registry,
SQLite ledger, and web client are provider-neutral. The installed transport is the
directly billed OpenAI Responses API because it supports first-class image
input, response chains, structured outputs, and application-defined functions.

The complete request path is:

```text
web or voice input
  -> orientation call with the exact request, bounded source context, and compact capability/tool catalog
  -> strict, source-referenced TurnBrief plus rolling conversation state
  -> execution call with the accepted TurnBrief and exact initial tool schemas
  -> optional exact-tool expansion inside accepted capability families, preserving receipts
  -> local or MCP tool execution, with results returned to that same model exchange
  -> conditional receipt-based completion audit
  -> optional receipt-aware repair within the remaining turn-wide budget
  -> final response
```

Every boundary is recorded in `activity_events` and shown in the web trace:
user request, orientation, rolling state, execution, conditional audit and
repair, context, tools, exact model requests and responses, tool calls and
results, per-step usage, and the final answer.

## Hats and the user manual

Users may make one or more roles explicit with the convention:

```text
Chapeaux Fous, as my [hat], [request].
```

Hats are optional and are never inferred. Requests without a spoken hat use the
ordinary capability selector exactly as before. More than one hat can be spoken
in one request, and ordinary tool selection may add other supporting tool
families without labeling them as hats. `config/hats.json` is the versioned
catalog of public names, aliases, destination capabilities, descriptions,
examples, and SVG artwork. The request compiler and the web client's **Hats**
manual screen both use that catalog; live availability and backing tool names
come from the actual callable tool registry. The web client displays hat artwork
only for hats the user explicitly spoke; it does not place the hats on a
character. With several spoken hats, it shows the first at full size and the
others as companion badges.

## First local run

Requirements: Node.js 22.5 or newer, an OpenAI API project/key with API billing,
and an existing Slayer database snapshot.

```bash
cp .env.example .env
# Set OPENAI_API_KEY and SLAYER_ACCESS_TOKEN in .env.
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
grouped personal logs with native entry creation, and a dedicated **Structured
Interactions** screen for maintaining reusable conversation briefs and their
numbered turns. Starting or resuming a brief from that screen queues a normal
Agent request, so the conversation still passes through orientation, TurnBrief
selection, exact tool schemas, and the literal trace. The screen itself is a
domain-management page, not an additional model-callable tool. Contacts support
people, organizations, and services with tags, birthday, notes, and stacked
contact methods. Possible duplicates are reviewed and merged explicitly; source records
remain as inactive history so existing references are preserved. Stored birthdays
continue to appear on the calendar. Agent requests may include one JPEG, PNG,
WebP, GIF, CSV, TSV, JSON, JSON Lines, vCard/VCF, or plain-text attachment. Text is decoded as UTF-8,
UTF-16, or Windows-1252. Image originals remain in the existing media store and
are loaded only while the queued request is processed. OpenAI receives images at
the configured detail; `original` is the default so small receipt text remains
visible. Small text files appear in full in visible model context;
large files contribute a bounded preview while native file tools can process the verified
full attachment. A task's Schedule
button opens the calendar in day-pick mode; selecting a day writes the task's
scheduled date as an all-day task. Timed tasks remain available through the
to-do editor and agent tools.

`.env` intentionally lives beside `.env.example` in the repository root. It is
ignored by Git and loaded by the process before configuration is evaluated.

## OpenAI Responses connection

Set `OPENAI_API_KEY` and the desired `SLAYER_MODEL` in `.env`, then restart the
process. The key remains server-side,
is absent from health and traces, and is redacted from provider errors. Every
Responses API call contains the exact currently callable function schemas.
Function results return through `function_call_output` in the same persisted
response chain before that execution or repair call can finish. Orientation and
completion audit calls have no callable functions and use strict structured
outputs instead.

`SLAYER_OPENAI_IMAGE_DETAIL=original` favors receipt legibility. Change it to
`high` or `low` when input-token efficiency matters more than tiny visual
details. `SLAYER_MAX_REQUEST_ATTACHMENT_BYTES` is a generous operational memory
ceiling, not a usage allowance, and can be raised. The dedicated **AI Usage**
screen totals recorded tokens and estimates USD cost. Its per-million-token
prices can be changed in the browser without modifying historical usage; server
defaults come from `SLAYER_AI_*_COST_PER_MILLION`.

## Conversation state

Each workflow phase is an explicit model interaction. Agent Slayer supplies
bounded application-owned context and the accepted TurnBrief instead of relying
on an opaque provider thread to remember what a short follow-up meant. If an
execution call requests an additional cataloged tool inside an accepted
capability family, its continuation receives that exact schema, the original
request, and bounded receipts for tools already used in that request. Legacy
direct execution may also request one additional cataloged capability.

Agent Slayer stores a compact, source-referenced rolling conversation state
after orientation. This state is an index, not authority: each new orienter also
receives exact recent ledger entries and may retain or change state only when
those event numbers support it. A bounded conversation checkpoint remains a
fallback when no structured state exists. Starting a new conversation creates a
ledger boundary for both recent context and rolling state without deleting
application history.

Deferred operations returned by an MCP remain owned by that MCP. Agent Slayer
does not copy their plans, payloads, readiness state, or lifecycle into a native
table or artifact event. It derives a small opaque action reference from the
existing immutable tool receipt so a later approval can select the exact
provider identifier; the MCP still validates and executes the operation. A
provider result that requests confirmation without a complete, schema-valid
same-provider action handoff is recorded as a terminal contract failure instead
of being presented for approval. Its exact result remains recoverable from the
receipt. Each orientation receives a bounded index of recent receipts without
their payloads, allowing execution to page a relevant exact receipt and recover
provider-owned workflow state rather than asking the user for an opaque ID.
Recovered evidence still cannot substitute for explicit mutation approval.

The default model is `gpt-5.6-terra`; change `SLAYER_MODEL` explicitly if
desired.

## Model transport boundary

`SlayerRuntime` depends only on the transport contract in
`src/model-transport.mjs`: identity, lifecycle, health, exact request
description, and `runTurn`. Tool definitions and tool results stay in Slayer's
provider-neutral format. A transport adapter performs protocol translation and
returns a normalized final response, usage report, and provider trace.

The installed adapter is `openai-responses`. The provider-neutral contract is
retained deliberately: another provider should require a protocol adapter while
modality-independent context, SQLite, tools, queueing, and ledger behavior
remain owned by Slayer. This is an explicit application boundary, not a plugin
system.

## Request and context compilation

Agent Slayer owns request and context compilation in application code.
Orientation receives the exact request, verified attachment context, exact
recent ledger entries, prior rolling state, explicit hats, and an organized
catalog of every connected capability family with compact provider-published
tool summaries but no callable schemas. It emits a strict `TurnBrief`
that classifies continuations, authorizations, corrections, additions, and new
objectives; identifies authorized and prohibited actions; selects required
capabilities and the smallest likely initial tool set; and defines concrete
completion criteria. Source-grounded fields carry ledger event numbers. This
lets “go ahead and do that” preserve a specific prior offer without hoping the
executor infers the same continuity.

Execution is compiled from the accepted TurnBrief. It receives the exact schemas
for the selected initial tools plus versioned guidance from
`config/instructions/`; `config/system-prompt.md` contains only universal
behavior. A bounded `request_tools` call can add exact schemas for omitted tools
inside the accepted capability families while preserving same-request receipts.
A newly registered local tool that has not yet been assigned to a capability
still forces the conservative full fallback so additions cannot silently
disappear.

The selected tool list is enforcement, not a hint: a model call outside the
current interaction's callable set is rejected before the application function
can run. Orientation and audit have no callable domain tools. Cataloged
capabilities become callable only after their exact schemas are present in an
execution interaction or continuation.
The trace records the selection reasons, selected versus available counts, the
exact provider-facing schemas and serialized bytes actually sent, instruction
character counts, and whether schemas were sent with a new thread or retained
on a resumed thread.

## Model usage

OpenAI calls record literal input, cached-input, output, reasoning, and total
tokens plus an estimated cost using configurable prices. The AI Usage screen
shows month and recorded totals and a per-call history. Estimates are editable
because provider prices can change; historical token counts remain the durable
authority. Each request card and trace also break usage down by orientation,
execution, audit, and repair, including reasoning effort, tokens, elapsed time,
and recorded estimated cost. Orientation defaults to `medium` reasoning,
execution uses the main configured effort, audit defaults to `low`, and repair
uses its own strong effort. These are configurable with
`SLAYER_ORIENTATION_REASONING_EFFORT`, `SLAYER_REASONING_EFFORT`,
`SLAYER_AUDIT_REASONING_EFFORT`, and `SLAYER_REPAIR_REASONING_EFFORT`.

## Tools

Local tools are ordinary JavaScript functions:

Native database-backed tool results preserve SQLite column names and attach the
schema-semantic compiler's operation-specific projection. The tracked semantic
form is therefore the single human-authored source for explaining stored fields
to the model; UI transport objects remain an independent browser concern.

Native discovery also has one in-process search coordinator. Calendar,
contacts, and conversation history keep their own matching and completeness
rules behind provider adapters, while the coordinator handles bounded
cross-domain fan-out, compact normalized hits, source-diverse interleaving, and
literal partial-failure reporting. This is separate from the pre-model
capability selector, which controls which exact tool schemas are callable.

- `web_page_read` fetches one explicit HTTP(S) URL and returns bounded extracted
  text, metadata, and links so the model can follow pagination or directly
  related pages. It is not a search tool. Each redirect is checked, private and
  local network targets are rejected, DNS is pinned for the request, and binary
  responses are not returned to the model.
- `todo_group_list`, `todo_group_create`, `todo_group_rename`,
  `todo_group_archive`, `todo_list`, `todo_add`, `todo_recurrence_set`,
  `todo_interaction_guide_set`, `todo_position_set`, and `todo_update` provide the native personal to-do path
  without requiring the model to invent SQL. The agent inspects existing groups before
  assigning an otherwise ungrouped task; Inbox is the catchall when no group is
  a clear match. Group archival fails while active tasks remain and preserves
  the group on terminal task history. Recurrence is supplied as structured,
  human concepts and stored internally as RRULE. New and existing tasks can be
  placed at an exact 1-based manual sort position, including position 1.
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
- `log_add`, `log_import`, `log_list`, `log_update`, `tracker_list`, and `tracker_update`
  provide the native grouped personal-log path. Each entry keeps complete
  natural-language content with optional numeric and unit projections for
  calculation and trends. Exact-ID corrections update an original entry without
  creating a duplicate. Bounded imports use generic source and external IDs for
  safe replay without source-specific application code.
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
- `interaction_guide_list`, `interaction_guide_get`,
  `interaction_guide_create`, `interaction_guide_update`,
  `interaction_guide_step_add`, `interaction_guide_step_update`,
  `interaction_guide_start`, `interaction_guide_step_answer`,
  `interaction_guide_run_cancel`, and
  `interaction_guide_archive` manage durable user-owned plans for structured,
  potentially multi-request interactions. A guide is a named, versioned
  container for numbered scripted steps. Each step has a fixed opening, agent
  instructions, JSON answers, explicit pending/active/completed progress, and a
  constrained completion mode. Current progress supports exact interruption
  and resumption; immutable run and answer history remains in the ledger. A
  recurring to-do may link to a guide while continuing to own its schedule and
  recurrence.
- `database_schema` and paginated `database_read` are a small read-only core
  capability available on every model request, including access to the native
  activity ledger. `database_write` is a separately routed capability, so broad
  database mutation authority is not sent merely to permit inspection. Ledger
  and schema tables remain protected from model writes. Each operation returns
  the exact projection compiled from the tracked schema-semantic form.
- `tool_receipt_list` and `tool_receipt_read` expose bounded, paginated access
  to exact historical call/result receipts. Tool results larger than
  `SLAYER_MAX_INLINE_TOOL_RESULT_CHARACTERS` remain whole in SQLite while the
  live model exchange receives a first chunk and receipt cursor. The model can
  retrieve additional chunks without repeating the original read or write.
- `history_recent`, `history_search`, and `history_range` read the
  application-owned exchange history. Date-range retrieval returns paired
  requests and responses, supports relative local periods through explicit UTC
  boundaries, and can apply a topical term filter across both sides of each
  exchange in the same lookup.
- `global_search` performs read-only discovery across selected calendar,
  contacts, and history providers. It returns compact references and reports
  each provider's actual matching mode, capabilities, completeness, warnings,
  and errors. History can use an existing synchronized FTS5 index for phrase or
  token-proximity matching with bounded contextual snippets; when that index is
  unavailable, the result explicitly reports its substring fallback. Existing
  domain search tools retain their schemas and native result shapes.
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
mirroring without making a local cache authoritative. Email does not use the MCP
configuration; the named local tool function performs each JMAP request and
returns its result to the same model exchange.

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
`config/mcp-servers.json` at process startup and rediscovered from every enabled,
authorized MCP when the web client's **Refresh** button is used. Added, removed,
and changed tool schemas replace that provider's prior registry entries. Their
exact discovered schemas are eligible for deterministic request selection
beside the local tools. Every
immediately callable schema is placed in the current model interaction; deferred
integration families appear first in the capability catalog and receive exact
schemas if the model requests them. The active model transport performs the
protocol translation. Provider-owned tools are not the application tool path.
Missing or failed integrations are visible in `/health`; they are never
silently represented as available.

An MCP can opt into application-managed persisted-file transfer by publishing
the versioned `agent-slayer/artifactUpload` metadata contract defined under
“Large artifacts across the Agent Slayer–MCP boundary” in
[`AGENT-TOOL-MANIFESTO.md`](AGENT-TOOL-MANIFESTO.md). Agent Slayer then exposes
one exact resumable file-upload function beside the provider's artifact consumer
tool. The application verifies local UTF-8 packaging, size, and SHA-256; sends
raw chunks of no more than 1 MiB through the provider's same-origin HTTP
artifact endpoint with the same bearer authorization; resumes from the
provider-confirmed byte offset; and verifies the completed provider artifact.
File contents never enter model context. Transfer does not infer or execute the
provider's domain workflow; the MCP consumer tool owns that later operation.
Required artifact routes or methods that contradict the advertised contract
are recorded as typed terminal failures. Agent Slayer does not let completion
repair retry that unchanged transfer, and it permits another attempt only after
a successful integration refresh rediscovers the provider tools.

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
`0700`. Set `SLAYER_MCP_OAUTH_ROOT` to override it.

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

## Video

The Agent view can select one through eight completed interactions and start a
single video production. The normal Agent turn first creates a portable,
source-grounded script; `video_production_create` then atomically persists that
script and queues its linked `video_jobs` row. Script creation follows the
ordinary orientation, bounded-context, exact-tool-schema, and receipt rules.

A single-concurrency background worker prepares the production after the Agent
turn finishes. Request scenes use the original saved recording when one exists;
otherwise, the typed request is spoken in a feminine voice with a subtle French
accent. Agent dialogue and narration use a masculine, standard-American voice.
Server-generated speech is explicitly disclosed as AI-generated in both the
Video Scripts page and the finished video. The
Remotion composition is a designed reproduction of the actual Agent interface—
request card, processing steps, tool activity, response, and timing—not a claim
that the product captured a screen recording.

The **Video Scripts** page remains the durable home for the portable script and
external-generator prompt. It also shows the linked background state, polls
while work is active, downloads completed MP4s, and can retry failed renders.
Rendering is deliberately outside the FIFO Agent request queue so a long MP4
does not block ordinary requests; interrupted `preparing` or `rendering` jobs
return to `queued` when the server starts.

Video production uses `SLAYER_VIDEO_OUTPUT_ROOT`, `SLAYER_TTS_MODEL`,
`SLAYER_TTS_AGENT_VOICE`, `SLAYER_TTS_AGENT_INSTRUCTIONS`,
`SLAYER_TTS_USER_VOICE`, `SLAYER_TTS_USER_INSTRUCTIONS`, and
`SLAYER_TTS_TIMEOUT_MS`. The legacy `SLAYER_TTS_VOICE` and
`SLAYER_TTS_INSTRUCTIONS` names remain Agent-role fallbacks.
`REMOTION_BROWSER_EXECUTABLE` may select an installed Chromium executable.
`OPENAI_API_KEY` is required when a queued production reaches narration.

## Voice transcription

The web client records audio and sends it to the same FIFO request queue. To
enable local transcription:

```bash
python3 -m venv voice/.venv
voice/.venv/bin/pip install -r voice/requirements.txt
```

The original recording is stored before transcription begins.

Responses to new typed and recorded requests are spoken by default through the
web browser's native speech synthesis. **Respond silently** suppresses speech
for that request and persists as a browser-local preference. This live-response
speech remains on the client device; the server-side speech service is reserved
for disclosed video narration. Written responses render GitHub-flavored Markdown after
HTML sanitization. Before speech playback, Markdown structure and formatting
punctuation are converted into natural pauses and spoken labels; code blocks are
left visible and summarized rather than read punctuation by punctuation.

## Deployment

`systemd/agent-slayer.service.example` is a reference only. Update its paths,
copy it into the user systemd directory, and enable it during the separate
deployment step.

After deploying an application update with no pending database migration,
restart the installed user service and inspect its status and recent startup
output:

```bash
systemctl --user restart agent-slayer.service
systemctl --user status agent-slayer.service --no-pager
journalctl --user -u agent-slayer.service -n 100 --no-pager
```

When an update includes a database migration, stop the running writer before
changing the database. If the dependency lock changed, install the exact
dependency set while the service is stopped. Then migrate, verify, and start the
service again:

```bash
cd /home/nate/code/agent-chapeaux-fous

systemctl --user stop agent-slayer.service
npm ci

npm run schema:migrate -- --no-semantics
npm run db:verify

systemctl --user start agent-slayer.service
systemctl --user status agent-slayer.service --no-pager
journalctl --user -u agent-slayer.service -n 100 --no-pager
```

Do not start the service if migration or verification fails. The migration
runner creates a timestamped backup under `data/backups/`, applies pending
migrations transactionally, and checks database integrity. The
`--no-semantics` option prevents deployment from rewriting the tracked semantic
catalog; schema-semantic changes should already be present in the deployed
revision. Running the migration command again is safe and reports when the
database is already current.

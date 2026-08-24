# Agent Slayer Structure

## Purpose

Agent Slayer is a private, self-hosted language-model interface to one user's
tools and data. It is a normal application, not an agent framework or plugin
host.

This document carries forward the numbered terminology from the earlier Slayer
design. The numbers are stable concept identifiers. Labels have been updated
where the implementation changed; the earlier label is noted when that helps
connect old discussions to this repository.

The central invariant is:

> Every **50. Agent request** begins with a literal orientation interaction
> containing the exact request, bounded source-referenced context, the strict
> TurnBrief schema, and the connected capability catalog. Execution receives the
> accepted TurnBrief and every exact callable schema before a requested tool can
> execute. Its result returns to the same model exchange before a final answer
> is accepted.

The immediate system priorities are:

1. Give **1. Agent Slayer application** controlled access to local and remote
   tools without enabling provider-owned tools outside Slayer's registry.
2. Preserve a literal, chronological account of each request in **19. Agent
   activity ledger**.
3. Keep personal history and application data in **35. Agent database** while
   keeping TLOM data behind **3. TLOM MCP server**.
4. Accept typed and recorded requests through **10. Agent Slayer web client**
   and process them in strict FIFO order.

## Current implementation decisions

- **1. Agent Slayer application** owns request intake, context construction,
  tool discovery, tool execution, queuing, persistence, and the final response.
- **2. OpenAI language model used by the agent** is reached through the OpenAI
  Responses API.
- **14. OpenAI Platform API account** is the selected model-authentication and
  metered-billing path. `OPENAI_API_KEY` remains server-side.
- **50. Agent requests** use explicit orientation, execution, conditional audit,
  and repair interactions. Exact callable schemas are present in execution and
  repair calls; the application-owned TurnBrief and rolling state carry intent
  across phases and later requests.
- Agent Slayer supplies base instructions, bounded context, images, and exact
  tool schemas. No provider-owned tool is enabled; an unexpected output item
  cannot execute application behavior.
- **51. Slayer runtime** is ordinary application code. It is not a
  context-engine plugin or a general plugin interface.
- **3. TLOM MCP server** is currently authenticated with a user-scoped bearer
  token supplied as `TLOM_ACCESS_TOKEN`. TLOM is required, so an unavailable
  TLOM connection prevents requests from running rather than pretending those
  tools exist.
- Generic MCP OAuth authorization-code support is selected independently by
  every server entry with an `oauth` block. Nutrition currently selects it;
  TLOM does not. Bearer-token integrations do not require Agent Slayer to have
  a public domain.
- **7. Agent-server transcription service** uses local faster-whisper. Original
  audio is stored before transcription begins. Audio is not sent through **8.
  Direct audio input to the OpenAI model**.
- **19. Agent activity ledger**, conversation history, and active profile facts
  are stored in the existing SQLite database. Explicitly approved schema
  changes are applied by the repository migration runner after it creates a
  backup.
- Recordings and request images live in **20. Agent media storage**; SQLite
  stores their metadata and relationships.
- The current UI displays the application revision, metered AI usage, request list,
literal event trace, calendar, grouped to-do list, and provider-neutral OAuth
integration manager. Its voice-first composer and live request progress
follow the interface requirements below. To-do task actions can enter a
temporary calendar day-pick mode for direct visual all-day scheduling. Timed
and all-day task schedules are stored distinctly.

## System boundary

### Owned by this repository

- **1. Agent Slayer application**, including its HTTP service and FIFO worker.
- **9. Agent Slayer HTTP service** and **10. Agent Slayer web client**.
- **11. Agent Slayer request queue** for typed and recorded requests.
- **14. OpenAI Platform API account** through the OpenAI Responses adapter.
- The provider-neutral model-transport contract.
- The application-owned local tool registry and MCP client.
- **19. Agent activity ledger**, **21. Agent short-term memory service**, **22.
  Agent long-term memory**, and **23. Agent observability system**.
- **20. Agent media storage**, **47. Private voice web client**, and **48.
  Voice-ingestion service**.
- Read and bounded write access to existing domain tables in **35. Agent
  database**.
- Generic MCP OAuth client support when an MCP configuration explicitly enables
  it.

### Outside this repository

- **2. OpenAI language model used by the agent** and the OpenAI Responses
  service.
- TLOM's application behavior, **3. TLOM MCP server**, **4. TLOM API**, and **34.
  TLOM database**.
- Every other remote MCP implementation and its private data.
- Reverse proxy, TLS, DNS, Tailscale, and host-level service administration.
- All components marked legacy, excluded, or deferred below.

For an MCP operation, the ledger records the call and result visible at Agent
Slayer's boundary. It does not claim to trace work performed inside TLOM or
another remote service.

## Request path

One **50. Agent request** follows this path:

```text
typed text, stored request image, or stored voice recording
  -> request row appended to the SQLite ledger
  -> strict FIFO queue
  -> local transcription when audio was supplied
  -> bounded profile and recent history context
  -> exact immediate tool schemas plus an organized deferred-capability catalog
  -> persistent OpenAI response chain with exact schemas sent on every call
  -> optional model-requested capability expansion in a replacement thread
  -> model tool call, if requested
  -> exact Agent Slayer function or remote MCP call
  -> tool result returned to the same model exchange
  -> final response
  -> terminal ledger event
```

The first model interaction contains four visibly separate inputs:

1. The exact user text, whether typed or transcribed.
2. Bounded context assembled from relevant active `profile_facts` and recent
   complete exchanges in **35. Agent database**.
3. The exact schemas returned by the live tool registry for immediate use.
4. A concise catalog of connected capability families whose detailed schemas
   were deferred and can be requested by the model.

The repository owns the validated standard-question catalog in
`config/profile-fact-questions.json`; **35. Agent database** alone owns the
user's answers. Before the model call, deterministic keyphrase matching selects
at most three broad, repeatable fact types relevant to the exact request. All
active rows of those types enter bounded context with stable row IDs and
self-contained natural-language text identifying their person or item. The
model replaces an exact row by ID when the same real-world fact changes or adds
another row when the fact concerns a different person or item. No extra model
call is made, and no profile section is sent when no catalog type is relevant.
The catalog is not a mandatory onboarding sequence, and stable facts outside it
remain valid profile facts accessible through the profile tools.

The model never receives a promised or hypothetical tool. Local tools are
registered only when the SQLite database is ready. Remote tools are registered
only after a successful MCP connection and live `tools/list`. Disabled, missing,
unauthorized, and failed integrations appear in health instead.

The model may make multiple tool calls inside the same request, up to
`SLAYER_MAX_TOOL_CALLS`. If it calls `request_capabilities`, Agent Slayer records
the requested families, completes that model turn, starts a replacement thread
with the expanded exact schemas and bounded history, and continues the original
user request automatically. Every domain call is dispatched by name through Agent
Slayer's registry. Its result or error is returned to the same active thread
before the final response is accepted.

## Model boundary

`SlayerRuntime` depends on the provider-neutral model transport defined in
`src/model-transport.mjs`. The selected adapter is OpenAI Responses in
`src/openai-responses-client.mjs`. It authenticates with the server-side API
key, sends image data directly to the model, translates Slayer schemas into
function definitions, and returns function outputs in the same response chain.
It normalizes provider tokens and cost estimates for the ledger.

The adapter never enables built-in OpenAI tools; Agent Slayer owns every
callable function and executes it through the existing registry. The exact
schemas are present in every Responses API request and in the literal trace.

Agent Slayer—not the provider—owns the MCP clients and application functions.
Adding a different model transport means implementing the existing transport
contract; it does not turn the application into a plugin system.

## Tool boundary

### Local tools

The current local application tools are:

Model-facing results from native database-backed tools use the stored SQLite
column names without a camelCase alias layer. Each such result carries the
schema-semantic compiler projection for the exact participating objects and
fields, keeping human field meaning in the tracked semantic form. Browser API
view models are separate from this model-facing contract.

- `todo_group_list`, `todo_group_create`, `todo_group_rename`,
  `todo_group_archive`, `todo_list`, `todo_add`, `todo_recurrence_set`, and
  `todo_update` for personal to-dos. Inbox is the fallback,
  while the model first inspects existing groups when the user did not name
  one. Archiving a non-Inbox group fails while active tasks remain and preserves
  the group on terminal task history. The UI and agent accept ordinary
  recurrence concepts and keep RRULE as an internal storage detail.
- `calendar_event_list`, `calendar_event_add`, `calendar_event_update`, and
  `calendar_event_recurrence_set` for native schedule reads and writes. Stored
  events use exact `calendar_events` field names plus compiler semantics;
  recurrence instances and contact birthdays are clearly separated as computed
  occurrences. All-day events and structured recurrence are first-class.
- `log_add`, `log_import`, `log_list`, `log_update`, `tracker_list`, and
  `tracker_update` for grouped, reusable personal tracking, complete
  time-stamped observations, exact-ID corrections, and idempotent bounded
  imports from any source.
- `profile_fact_list`, `profile_fact_set`, and `profile_fact_delete` for durable
  user facts. Broad fact types may repeat; replacement and deletion target an
  exact stable row ID and archive the previous row.
- `database_schema` for inspecting existing SQLite objects without changing
  schema. A selected object also returns its exact schema-semantic projection.
- `database_read` for bounded reads with equality filters and no raw SQL.
- `database_write` for inserts, updates, and deletes in approved existing domain
  tables. Ledger, file, metadata, and schema tables are protected.
- `history_recent`, `history_search`, and `history_range` for the
  application-owned chronological conversation history. Range results pair
  requests with responses and paginate within inclusive-start, exclusive-end
  UTC boundaries. An optional topical query intersects that time window with
  terms found across either side of each exchange.
- `global_search` for bounded read-only discovery across the calendar,
  contacts, and history providers. The in-process coordinator normalizes compact
  hits and partial-result metadata without replacing native domain semantics.
  Synchronized history FTS5 indexes may add phrase, proximity, and contextual
  snippet support; capability selection remains a separate pre-model boundary.

These are JavaScript functions registered directly with the runtime. There is
no runtime plugin loading mechanism.

### Remote MCP tools

Agent Slayer reads `config/mcp-servers.json` at startup and independently
connects to each enabled MCP server. Remote schemas discovered by `tools/list`
are registered under provider-neutral names such as
`remote_tlom_<upstream-tool-name>`. The source and original upstream name remain
available in the registry and health output. The web client's **Refresh** action
reconnects to every enabled, authorized MCP and replaces that provider's
registered tool names and schemas with its latest `tools/list` response.

The current TLOM configuration is:

```text
Agent Slayer -> Authorization: Bearer ${TLOM_ACCESS_TOKEN}
             -> https://mytlom.com/api/mcp
             -> user-scoped TLOM tools and data
```

The token belongs in the server's untracked `.env`, never in
`config/mcp-servers.json` or Git. TLOM is responsible for issuing the token,
mapping it to one TLOM user, enforcing its scopes, and rejecting revoked or
expired credentials. Agent Slayer receives only the tools and results TLOM
allows for that user.

The generic OAuth implementation supports discovery, dynamic client
registration, authorization code, PKCE, refresh tokens, and file-backed secret
storage. It becomes active only for a server entry with an `oauth` block. A
public HTTPS callback origin is therefore an OAuth deployment requirement, not
a requirement for the current TLOM bearer-token connection.

The web client keeps one general Integrations control in the header and renders
every configured OAuth provider inside it. Each integration's client
registration and tokens are stored in its own private file. Disconnect closes
that MCP client, unregisters only its tools, and removes the local credential
file contents; it does not claim remote provider revocation.

## Complete history and memory

There is one chronological application history. Recent memory and old memory
are different queries over it, not separate stores.

The active OpenAI response chain carries native message and tool history across
requests. Starting a new conversation resets that model-visible history without
deleting the application ledger or domain data. The model can explicitly invoke
`history_recent`, `history_search`, or `history_range` when older application
history is needed. A range lookup can apply the topic inferred from the current
request during the same database operation.

This preserves the distinction between:

- **21. Agent short-term memory service**: the active resumable model response chain.
- **22. Agent long-term memory**: explicit search over older requests and
  responses in the same ledger.

Domain records are not converted into prose memory. Personal tasks remain in
their domain tables. TLOM records remain in **34. TLOM database** and are fetched
through **3. TLOM MCP server** when needed.

## Agent activity ledger and observability

**19. Agent activity ledger** is the append-only application record in
`activity_events`. It records what Agent Slayer can actually observe, including:

- request receipt, queueing, processing, completion, and failure;
- original recording metadata and transcription boundaries;
- the exact bounded context sent to the model;
- the exact callable-tool definitions sent to the model;
- the model request description and visible model response;
- each tool call, arguments, result, error, and operation identifier;
- the final response returned by the application;
- provider tokens, configurable estimated API cost, and fallback ChatGPT quota observations.

The ledger does not claim to contain hidden model reasoning or events hidden
inside a remote MCP implementation. Secret-like values are passed through the
application's redaction boundary before JSON event payloads are stored.

**23. Agent observability system** is the `/health` response, AI Usage screen,
plus the web trace
derived from the ledger. Health reports the runtime revision, database status,
model transport, authentication mode, version check, quota, integrations, and
actually registered tools. The per-request trace stays chronological and
literal so the user does not need internal lifecycle terminology to understand
what happened.

### Voice-first request interface

The normal phone layout is voice-first:

1. A large red record button is the first and most prominent request control at
   the top of the page.
2. Pressing it starts recording and changes the same control into an unmistakable
   stop-recording state.
3. Typed input remains available immediately below it as the secondary request
   path.
4. Submitting either form immediately creates a visible request card in its FIFO
   position.

Every active request card shows one continuously updating elapsed-time counter
and a concise description of the operation happening now. Examples include
`Queued`, `Saving recording`, `Transcribing`, `Building context`, `Waiting for
model`, `Running <tool>`, and `Finishing response`. The stage comes from the
latest chronological event in **19. Agent activity ledger**, not from an
independent client-side guess. The elapsed time starts when the server receives
the request and stops at its terminal completion or error event.

The compact timer and current-stage line are the default view. The full **23.
Agent observability system** remains available on demand for exact context,
model, tool, result, error, and timing events. This keeps the ordinary request
screen readable while preserving the complete trace.

## Agent database

**35. Agent database** is an existing SQLite snapshot at `data/agent.sqlite` by
default. It is runtime data, is ignored by Git, and is never synthesized by this
repository. `npm run db:verify` checks the file, required tables and columns,
and SQLite integrity.

The minimum required tables are:

- `database_meta` for the current schema version;
- `activity_events` for **19. Agent activity ledger**;
- `files` for references into **20. Agent media storage**;
- `contacts`, `calendar_events`, and `calendar_event_exclusions` for the native
  calendar and its derived birthday and recurrence views;
- `todo_groups` and `personal_tasks` for the native to-do tools;
- `log_groups`, `trackers`, and `log_entries` for the native personal-log tools; and
- `profile_facts` for active and archived durable user facts.

Other compatible tables and views in the supplied snapshot may be inspected by
`database_schema` and accessed through bounded database tools. Agent Slayer does
not accept raw SQL from the model. Identifiers are validated, result counts are
bounded, update and delete require nonempty equality filters, writes are
transactional, and runtime-owned tables are protected from model writes.

SQLite is authoritative for rows and schema mechanics. Approved schema changes
are recorded in `db/migrations.sql`; `npm run schema:migrate` creates a backup,
applies pending migrations transactionally, checks integrity, and synchronizes
the mechanical catalog in `db/schema-semantics.json`. Humans own the meanings
in that form. `npm run db:verify` checks the database shape, migration sequence,
integrity, and semantic-form mechanics before and after database-dependent work.

The schema semantic compiler is deterministic and read-only. Structured
database tools return the exact relevant projection in their result, and the
ledger records that compilation. The compiler does not read data, authorize an
operation, select an access policy, or execute SQL. It is not currently used for
pre-model request enrichment.

### Applying Agent Slayer database migrations

Agent Slayer writes to `data/agent.sqlite`. Stop that writer before applying a
migration, then verify the database before starting it again. After pulling a
revision whose dependency lock changed, install that exact dependency set while
the service is stopped:

```bash
cd /home/nate/code/agent-slayer

systemctl --user stop agent-slayer.service
npm ci

npm run schema:migrate -- --no-semantics
npm run db:verify

systemctl --user start agent-slayer.service
systemctl --user status agent-slayer.service --no-pager
journalctl --user -u agent-slayer.service -n 100 --no-pager
```

Do not start the service if migration or verification fails. The migration
runner checks foreign keys and SQLite integrity before changing the database,
creates a timestamped backup under `data/backups/`, applies each pending
migration transactionally, and checks integrity again. `--no-semantics` keeps a
deployment from rewriting the tracked catalog: development commits that catalog,
and the runtime compiler selects relevant projections from it. Running the
migration again is safe and reports that the database is already current.

## Voice path

The implemented recorded-request path is:

1. **47. Private voice web client** uses **15. Phone audio recorder** in the
   browser to create a recording.
2. **16. Audio transport** uploads the recording to **48. Voice-ingestion
   service** with the Agent Slayer bearer token.
3. The server writes the file into **20. Agent media storage**, synchronizes it,
   computes its hash, registers its metadata, and only then creates the queued
   request.
4. **11. Agent Slayer request queue** processes requests one at a time in ledger
   order.
5. **7. Agent-server transcription service** invokes the local faster-whisper
   worker and records the resulting text.
6. The text continues through the same **51. Slayer runtime** used by typed
   requests.
7. Unless the user selected Respond silently for that request, **10. Agent
   Slayer web client** retains the queued request ID and uses the browser's
   native speech synthesis to speak its completed final response.

Typed requests skip file storage and transcription but enter the same FIFO.
The current browser retains its access token, persistent Respond silently
preference, and pending spoken-response IDs locally. It automatically speaks
completed responses by default through browser-native speech synthesis. Written
responses render sanitized GitHub-flavored Markdown, while speech receives a
plain-language traversal of the Markdown structure instead of raw formatting
punctuation. It does not yet implement the earlier IndexedDB upload outbox or
live interruption semantics.

## Access and deployment boundary

The application listens on `127.0.0.1:8787` by default. Protected API routes
require `SLAYER_ACCESS_TOKEN`; only isolated local development may explicitly
allow unauthenticated access. A reverse proxy or private tunnel may publish the
loopback service, but that host configuration is outside this repository.

Secrets belong in the repository-root `.env`, which is ignored by Git. The
current required integration secret is:

```dotenv
TLOM_ACCESS_TOKEN=<user-scoped-token-issued-by-TLOM>
```

The reference systemd unit is
`systemd/agent-slayer.service.example`. Deployment, service installation,
reverse-proxy changes, and restarts are separate live-system actions; repository
changes do not perform them automatically.

After deploying an application update with no pending database migration,
restart the installed user service:

```bash
systemctl --user restart agent-slayer.service
```

When the update includes a database migration, use the stop, migrate, verify,
and start sequence under **Applying Agent Slayer database migrations** instead.

Confirm that the new process is running and inspect recent startup output:

```bash
systemctl --user status agent-slayer.service --no-pager
journalctl --user -u agent-slayer.service -n 100 --no-pager
```

## Retained but inactive directions

The numbered vocabulary deliberately retains concepts from the earlier design
so old notes and future discussions stay understandable.

- **5. Legacy phone-app transcription**, **6. Phone-native
  transcription**, and **8. Direct audio input to the OpenAI model** are not the
  selected request path.
- **12. ChatGPT subscription** and **13. ChatGPT subscription connection** are
  retained only as historical vocabulary; no subscription-backed model path is
  implemented.
- **17. Agent speech-generation service** is not implemented; speech generation
  currently uses the web browser's native speech engine.
- **18. Phone audio player** is implemented as automatic browser speech playback
  for requests submitted by that browser. Live interruption is not implemented.
- **24. TimeV3 MCP server** is not configured in this repository.
- **25–33** and **36** retain the former video, publishing, and telephone design;
  none is implemented here.
- **37–40** retain the personal-communications design; none is implemented here.
- **41–44** retain the old upstream-contribution concepts for historical
  reference. They are not part of the current request runtime.
- **45. Adobe Premiere bridge** and **46. Android voice-client candidate** are
  not part of the current application.
- **49. Schema semantic compiler** is installed and invoked for structured
  local database operations. It is not a pre-model enrichment layer.

## Terminology

The number is part of each canonical name. A retained term may describe an
excluded, legacy, or future option; its presence here does not claim that the
corresponding feature is callable.

**1. Agent Slayer application** — The
standalone Node.js application that receives requests, constructs context,
registers and executes tools, calls the model transport, records activity, and
returns the final response.

**2. OpenAI language model used by the agent** (LLM) — The OpenAI model selected
by `SLAYER_MODEL` and reached through the configured provider-neutral transport.

**3. TLOM MCP server** — TLOM's user-scoped Streamable HTTP MCP endpoint at
`https://mytlom.com/api/mcp`, from which Agent Slayer discovers property,
building, item, manual, and property-task tools.

**4. TLOM API** — TLOM's backend, including the implementation beneath **3.
TLOM MCP server**. It is owned by the TLOM product, not this repository.

**5. Legacy phone-app transcription** — The earlier proposal to use a separate
phone client's transcription path. It is absent from the current system.

**6. Phone-native transcription** — Speech-to-text completed by the phone or
keyboard before text reaches Agent Slayer. It does not preserve original audio
and is not the selected recorded-request path.

**7. Agent-server transcription service** — The local faster-whisper worker
that converts a stored recording into text before the model request.

**8. Direct audio input to the OpenAI model** — Sending original audio to an
audio-capable OpenAI model. It is explicitly excluded from the current design.

**9. Agent Slayer HTTP service** — The loopback
Node HTTP server that provides static files, health, request, voice, trace, and
optional MCP OAuth endpoints.

**10. Agent Slayer web client** — The
mobile-friendly browser client for typed input, image/file attachment,
recording, request status, API usage/cost, integration state, and request traces. Its target phone layout puts a
large red voice button first and shows elapsed time plus the current operation
for every active request.

**11. Agent Slayer request queue** — The application-owned strict FIFO worker
shared by typed and recorded
requests.

**12. ChatGPT subscription** — A historical concept from the removed
subscription-backed model path. It is separate from **14. OpenAI Platform API
account** billing and is not used by this application.

**13. ChatGPT subscription connection** *(formerly ChatGPT OAuth connection)* —
A historical concept from the removed subscription-backed model path. No such
connection is configured or callable.

**14. OpenAI Platform API account** — The selected separately metered developer
service authenticated with the server-side `OPENAI_API_KEY`. Token usage and
editable cost estimates are visible on the AI Usage screen.

**15. Phone audio recorder** — The browser `MediaRecorder` path that captures an
original microphone recording for upload.

**16. Audio transport** — The authenticated HTTP upload from **10. Agent Slayer
web client** to **48. Voice-ingestion service**. TLS or private-network
publication is supplied by deployment infrastructure.

**17. Agent speech-generation service** — A possible future server-side speech
component. The current product instead turns final responses into speech in the
web client through browser-native speech synthesis.

**18. Phone audio player** — The current web client automatically speaks each
completed response submitted by that browser unless Respond silently was
selected. The preference and pending response IDs survive reloads in browser
storage. Stopping or interrupting playback is not yet implemented.

**19. Agent activity ledger** — The append-only chronological record of
observable request, context, model, tool, response, error, usage, and media
events stored in `activity_events`.

**20. Agent media storage** — The configured filesystem root for original voice
recordings and any future request artifacts, with metadata stored in `files`.

**21. Agent short-term memory service** — The bounded recent-history query used
when constructing context for one request. It is not a separate database.

**22. Agent long-term memory** — Explicit text search over older requests and
responses in the same chronological ledger.

**23. Agent observability system** — Health and per-request trace views derived
from runtime state and **19. Agent activity ledger**, including the compact live
elapsed-time and current-stage display.

**24. TimeV3 MCP server** — A possible controlled TimeV3 tool boundary. It is
retained in the vocabulary but is not currently configured.

**25. Video-content service** — A deferred application that would package a
specifically requested interaction for video rendering.

**26. Video-rendering worker** — A deferred process that would render a
structured video project to an MP4.

**27. Video template** — A deferred reusable visual and editorial arrangement
for captions, audio, imagery, activity, branding, and timing.

**28. Interaction-replay interface** — A deferred visual reconstruction of a
request from ledger events rather than a screen recording.

**29. Content-selection process** — A deferred automated process for choosing
interactions to turn into content.

**30. Content approval queue** — A deferred interface for reviewing, editing,
approving, rejecting, or scheduling generated content.

**31. Social publishing integration** — Deferred connections that would publish
content to external social platforms and record the result.

**32. Telephone provider** — A deferred SIP, Twilio, or similar call transport.

**33. Telephone-answering agent path** — A deferred call-specific workflow
joining a telephone provider, voice handling, Agent Slayer, tools, history, and
speech generation.

**34. TLOM database** — TLOM's private application data store. TLOM owns its
schema, user isolation, authorization, and internal instrumentation.

**35. Agent database** — The externally supplied SQLite snapshot containing
Agent Slayer's ledger, history, files, durable profile facts, personal to-dos,
personal logs, and any compatible domain tables and views.

**36. Publishable-content filter** — A deferred boundary that would remove
secrets and unrelated private material before selected activity becomes content
input.

**37. Personal communications server** — A deferred authoritative self-hosted
email, calendar, and contacts service.

**38. Independent audit writer** — A deferred separate writer that could make
the activity ledger more resistant to mutation by ordinary application actions.

**39. Agent communications interface** — A deferred controlled interface for
email, calendar, contacts, and related communications.

**40. Public email network** — External mail servers and SMTP delivery outside
a future personal communications server.

**41. Legacy upstream project** — The public project used by the earlier
architecture. It is not a dependency of the current Agent Slayer application.

**42. Upstream contribution workflow** — The retained process for researching
and proposing an issue, test, documentation correction, or patch to an upstream
dependency when explicitly authorized.

**43. GitHub contribution identity** — The user's GitHub account, credentials,
authorship, and permissions used for an authorized public contribution.

**44. Contribution audit trail** — Ledger events connecting an observed issue
to research, a proposal, authorized public activity, feedback, and outcome.

**45. Adobe Premiere bridge** — A deferred desktop integration that could turn
structured video jobs into Premiere projects and exports.

**46. Android voice-client candidate** — A retained category for evaluating a
replaceable native Android voice client. No candidate is part of this runtime.

**47. Private voice web client** *(formerly Tailnet voice web client)* — The
recording-capable portion of **10. Agent Slayer web client**. It can be published
privately through deployment infrastructure but is not coupled to Tailscale. Its
primary control is the large red recording button at the top of the phone
interface.

**48. Voice-ingestion service** — The `/api/voice` path that authenticates and
stores original audio, registers the file, creates a request, and wakes the FIFO
worker.

**49. Schema semantic compiler** — The deterministic schema-explanation package
that combines SQLite mechanics with human-authored meanings. It is pinned as a
dependency and compiles exact projections for structured database operations;
it neither accesses rows nor decides or enforces authorization.

**50. Agent request** — One user input and all processing until exactly one final
user-visible response or error. Internally it is correlated by a request UUID
stored as `turn_id`; “turn” remains a transport or schema mechanic, not the
preferred user-facing term.

**51. Slayer runtime** *(formerly Slayer runtime plugin)* — The application code
that builds the exact model request, records its context and tools, runs the
provider-neutral transport, dispatches requested tools through the registry,
returns each result to the same model exchange, and accepts the final response.
It is not a plugin.

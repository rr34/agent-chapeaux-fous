Agent Slayer uses the following building blocks to turn natural speech into
efficient, authorized tool use. Each heading is a positive, comprehensive list
of the responsibilities owned by that building block - meaning if the block owns the responsibility it should take care of it, and also if the responsibility is not in the block, the block should not do it at all. Numbered system terms are defined in  `AGENT-TERMINOLOGY.md`.

# 1. The LLM

The LLM translates natural speech and selected evidence into structured
instructions or a user-facing response.

The LLM receives:

- one specific interaction objective;
- the exact user request when that interaction needs it;
- bounded, source-referenced context selected for that objective;
- an exact output schema for a structured interaction;
- a concise catalog when it must select capability families or initial tools;
- exact callable tool schemas only when it may call those tools.

The LLM produces:

- output that validates against the interaction's schema;
- exact tool names and schema-valid arguments during execution;
- explicit statements of missing information or uncertainty; and
- concise natural-language responses grounded in the supplied context and tool
  results.

Model calls are measured individually for input, output, latency, and cost. A
model call should do one well-defined language task with the smallest context
that can reliably complete it.

# 2. The agent structure

The agent structure is everything in the agent except the LLM. It is the bridge
between natural speech and efficient tool use.

The agent structure owns:

- request intake and the exact-request record;
- bounded conversation context;
- private account enrichment and shared AI-assisted product enrichment;
- capability catalogs and selection;
- exact tool-schema visibility;
- authorization binding and approval state;
- execution and delivery of each result to the same model exchange;
- request state, persistence, receipts, and final responses;
- orientation, execution-context preparation, execution, audit, and repair;
- a literal chronological trace of every observable step; and
- per-step model usage, tool usage, failures, and timing.

For every request, the structure:

1. preserves the user's exact request;
2. constructs bounded, source-referenced conversation context;
3. gives orientation the strict TurnBrief output schema;
4. gives orientation an organized catalog of connected capability families and
   their compact provider-published tool summaries, without callable schemas;
5. validates the TurnBrief;
6. reads only the named, bounded, read-only context views selected in the
   TurnBrief;
7. gives execution the accepted TurnBrief, prepared context, and every exact
   callable schema for the initial tools selected by orientation;
8. invokes the exact application function named by a valid model tool call;
9. returns each tool result to the same model exchange; and
10. accepts a final answer only after the required completion checks.

TurnBrief validation includes deterministic facts that application code can
prove without interpreting user intent. In particular, a named weekday and a
resolved local calendar date must agree before execution begins. A rejected
candidate is visibly repaired once and revalidated; a second failure stops the
request before mutation tools become callable. Source-referenced temporal
targets are carried into participating domain tools, which reject scheduled
timestamps outside the authorized local dates before retaining any mutation.

Context views are small, live, domain-owned reference datasets such as active
contact tags, to-do groups, or log trackers. Each view is advertised in the
capability catalog, selected through `contextRequests`, read through its owning
domain service, recorded literally, and supplied to execution without another
model call.

Context views read current tool-owned data for one execution. Account-specific
and shared product enrichment are separate, optional agent layers defined in
section 2E.

The structure improves iteratively from trace evidence. Improvements update
explicit, testable retrieval rules, filters, catalogs, schemas, and interaction
definitions.

# 2B. Search engine / filter / pruner

The search engine is deterministic application code. It does not contain an
LLM, call an LLM, understand a natural-language objective, or decide for itself
what would answer that objective. The LLM translates the objective into
schema-valid search instructions: selected sources from the advertised,
authorized read capabilities; query text, concepts, and filters; requested
fields; matching options; and bounds. The search code mechanically executes
those instructions.

Every time an LLM requests data, it produces a valid search-protocol request.
Every retrieved dataset passes through the search engine before any of that data
enters subsequent LLM context. This rule applies even when the retrieved dataset
is already small and the filter determines that nothing needs to be removed.

The application carries and records the retrieval objective for traceability
and for the LLM to validate the returned evidence afterward. The search engine
does not consume that objective as an executable instruction, derive a query
from it, or use it to judge semantic relevance. If the evidence does not satisfy
the objective, the LLM may issue another structured search request with revised
operational instructions.

The search engine owns:

- validating that requested sources are among the advertised, authorized read
  capabilities;
- bounded candidate retrieval through the selected sources' owned read paths;
- deterministic query normalization, matching, provider-native or explicitly
  programmed ranking, and rule-based deduplication;
- deterministic filtering and pruning according to the supplied query, field,
  match, and limit instructions;
- preserving stable source references and partial-result metadata;
- enforcing context-size and result-count limits;
- applying the exact requested schema projection while retaining protected
  identity and reference fields; and
- reporting mechanically observable execution metadata such as matched fields,
  scores, counts, limits, pruning reasons, pagination, warnings, and errors.

The LLM owns interpreting the objective, selecting sources, constructing the
operational query and filters, requesting the useful fields and bounds, and
judging whether the returned evidence answers the objective. The application
structure owns advertising and enforcing which sources are authorized.

Every retrieval path follows this sequence:

1. the LLM converts the retrieval objective into structured operational search
   instructions and selects from authorized sources;
2. the application validates the request and its source authorization;
3. the search engine retrieves a bounded candidate set through each selected
   source's owned read path;
4. the search engine mechanically normalizes, matches, ranks, deduplicates,
   filters, projects, and limits candidates using provider behavior and explicit
   programmed rules;
5. the search engine returns compact evidence with stable references and
   execution metadata; and
6. the LLM compares that evidence with the preserved objective and decides
   whether the objective is satisfied or another search is needed.

Provider-native search accesses provider-owned data. The Agent Slayer search
layer mechanically bounds and shapes those provider results according to the
LLM's structured instructions before they enter model context.

When a structured retrieval path is explicitly integrated with the
schema-semantics compiler, the compiler supplies exact projections and
machine-readable rules that code can apply. The LLM, not the search engine,
interprets the human-readable field meanings when evaluating the evidence.

# 2C. Structured problem-solving method

Agent Slayer uses a structured loop derived from the military OODA loop:

1. **Orient** — preserve the exact request, gather and filter bounded context,
   select capability families and the smallest likely initial tool set, request
   required context views, describe the intended outcome, and declare
   completion and audit needs in the TurnBrief.
2. **Execute** — receive the accepted TurnBrief and prepared context, expose
   exact callable schemas for the selected tools, invoke tools, return every
   result to the same model exchange, and request exact additional tools inside
   the accepted capability families when observed evidence requires them.
3. **Audit** — compare the observed outcome with the request, TurnBrief,
   deterministic findings, effect annotations, and trustworthy receipts.
4. **Repair** — correct a concrete audited gap within the user's authorization
   and verify the repaired outcome.

Audit is required when the TurnBrief requests it, deterministic findings call
for it, or a successful tool declares effects that merit verification. A single
declared read-only call may complete without audit when the TurnBrief does not
request one. Unknown effects are treated conservatively.

Completion of an authorized mutation requires a successful receipt for the
exact bound tool and arguments. Status reads and receipt inspection provide
evidence for audit; the exact mutation receipt proves completion.

# 2D. Conversation types / structured interactions

Agent Slayer supports two conversation types:

- **Normal conversation** responds directly to the user's request with the
  relevant bounded context.
- **Structured interaction** follows a named interaction contract with defined
  inputs, stages, outputs, and completion evidence.

Use a structured interaction whenever the task has a repeatable shape,
provider-defined workflow, required information, consequential action, or
reporting standard.

Every structured interaction defines:

- a stable name, purpose, and trigger;
- required and optional inputs;
- the source and bound for every context input;
- the model instructions and exact output schema for each model step;
- the capabilities and context views available at each stage;
- validation, authorization, and approval requirements;
- success, incomplete, partial, error, and retry outputs;
- completion evidence; and
- the next permitted interaction or tool invocation.

Core structured interaction families include:

- **Provider-defined workflows** — previews, plans, approvals, commits,
  revalidation, retries, and receipts defined by the MCP that owns the action.
- **Information gathering** — known inputs, exact missing fields, bounded
  questions, source requirements, batch completeness, and retry instructions.
- **Information reporting** — audience, requested scope, source references,
  ordering, format, partial-result disclosure, and confidence or uncertainty.
- **Agent request processing** — orientation, execution-context preparation,
  execution, conditional audit, and repair.

Interaction state is explicit and source-referenced. The trace records the
accepted structured output and every transition literally.

# 2E. Enrichment

Enrichment is an optional agent improvement layer and is deliberately the last
agent-structure subsection. Agent Slayer must remain correct, authorized,
traceable, and useful without it. Enrichment may improve later interpretation
or retrieval, but it never overrides the exact user request, current tool-owned
data, authorization, tool schemas, or provider results.

Agent Slayer distinguishes private account enrichment from shared AI-assisted
product enrichment. They have different sources, persistence, review, and
privacy boundaries and must never be silently combined.

## 2E.1. Private account enrichment

Private account enrichment stores durable meaning that is specific to one user
or deployment. The current implementation's durable profile facts are account
enrichment. Future account enrichment may include user-specific aliases,
terminology, preferences, relationships, or confirmed interpretations.

Account enrichment:

- is grounded in an explicit or casual user statement, a user correction, or a
  user-confirmed interpretation, never an unconfirmed model inference;
- when persistence is involved, is written only through an exact authorized
  path owned by the agent or the relevant domain and is recorded with its source
  and receipt;
- remains scoped to that account and is never promoted into a product-wide rule
  merely because one user supplied it;
- supports exact correction, replacement, archival, and forgetting;
- is selected into model context only when relevant and within explicit bounds;
- does not duplicate conversation history, file metadata, transient working
  state, tool arguments, or authoritative domain records; and
- cannot override fresher tool-owned facts or provider business rules.

Private account enrichment is not a prerequisite for improving the shared
product and does not require aggregating many users' data.

## 2E.2. Shared AI-assisted product enrichment

Shared AI-assisted product enrichment improves behavior for every user. An LLM
may help a developer propose reusable artifacts such as synonym and alias
catalogs, phonetic and spelling variants, normalization rules, explicit concept
equivalences, schema meanings, routing examples, ranking rules, and retrieval
test cases. This work may use owned domain documentation, tool schemas,
developer-supplied examples, synthetic cases, and trace evidence explicitly
approved for product improvement.

AI-generated proposals do not enter runtime behavior directly. Before the
application or search layer may consume one, it becomes an explicit artifact
that is reviewed, versioned, tested, source-described, and reversible. Search
then mechanically applies that artifact just as it applies any other programmed
rule. This can make search more tolerant of phonetic spellings, misspellings,
aliases, and domain language, but it does not give the search engine an LLM or
the ability to understand a natural-language objective.

Shared enrichment:

- must state its supported behavior and deterministic runtime effect;
- must include positive, negative, ambiguity, and regression tests;
- must preserve provenance and version history so a harmful rule can be
  identified and rolled back;
- must not infer product-wide meaning from private account data by default;
- may use account-derived evidence only through an explicit, privacy-approved
  process that defines consent, minimization, de-identification, and retention;
  and
- must report matching or routing behavior literally enough to evaluate whether
  the enrichment helped or introduced noise.

A large user population may provide more usage evidence, but it is not required
for this work. One developer using AI can build shared enrichment from domain
knowledge, observed failures, and designed test cases. What cannot be claimed
without representative evidence is that such enrichment covers how all users
will speak.

# 3. MCP

An MCP is a connected owner of tools, data, and domain workflows. The same
ownership checklist applies to a native Agent Slayer capability and a remote
MCP server.

Each MCP owns:

- its entities and authoritative persistence;
- domain field meanings and relationships;
- read and mutation services;
- business validation and transaction boundaries;
- authentication, authorization, and user isolation;
- defaults and required inputs;
- batch completeness and retry safety;
- idempotency and duplicate prevention;
- previews, plans, expiration, and revalidation;
- commit behavior and the truth about what changed;
- structured success, incomplete, partial, and error results; and
- receipts for observable effects.

Each MCP publishes a capability manifest containing:

- a stable capability ID, title, summary, and aliases;
- server identity, title, and instructions;
- capability-scoped guidance;
- tool dependencies and attachment hints;
- named bounded read-only context views; and
- current tool metadata exposed through discovery.

## 3A. The Tool Description contract

Tool use is the Agent's primary operational boundary, so every native and MCP
tool is described through one layered contract. The layers become progressively
more exact; a compact earlier layer routes to a later layer but never replaces
or paraphrases it.

1. **Machine name** — the stable callable identity.
2. **Concise title** — a short human label for catalogs and traces.
3. **Selection summary** — one or two human-authored routing sentences stating
   the concrete outcome, when to select the tool, and the nearest important
   distinction.
4. **Action and effect classifications** — validated structured routing facts
   used to generate the selection-summary suffix.
5. **Operations** — an optional bounded provider-owned list for a dispatcher
   tool whose generic `entity`, `workflow`, `operation`, or `action` field hides
   materially different operations. An ordinary focused tool omits this layer.
6. **Execution description** — the complete provider-owned instructions stating
   how and when to use the tool and what its result proves.
7. **Exact input schema** — the complete callable argument contract.
8. **Exact output schema and result states** — structured success, incomplete,
   partial, error, retry, and handoff shapes.
9. **Protocol annotations and metadata** — truthful read-only, destructive,
   idempotent, open-world, artifact, and other protocol facts.
10. **Owning implementation** — authorization, validation, transactions,
    idempotency, persistence, and actual effects behind the published contract.

Layers 1 through 5 form the orientation catalog entry. Layers 6 through 9 are
shown only when the exact tool becomes callable in execution. Layer 10 never
becomes model context; the model observes only its published contracts and
results.

Every Tool Description validates against the single authoritative versioned
schema at
`config/protocol-schemas/tool-description.v1.schema.json`. Native tools publish
the description in their owned registration. An MCP may publish the same object
in its standard tool `_meta` field under the extension key
`_meta["agent-slayer/selection"]`; an application adapter may instead supply
explicit source-referenced metadata when the provider cannot publish the
extension itself. Agent Slayer validates either source identically and never
silently truncates an execution description into a selection summary.

The MCP extension is an Agent Slayer interoperability contract, not a claim
that base MCP requires this field. A remote tool lacking it may remain
connected for compatibility, but its catalog entry explicitly says that Tool
Description metadata is missing; Agent Slayer does not invent provider meaning
or present a clipped execution description as validated routing evidence.

The extension object has this exact shape:

```json
{
  "protocol": "agent-slayer.tool-description",
  "version": 1,
  "summary": "Execute one guarded provider workflow after its exact operation is selected.",
  "actionClasses": ["EXECUTE"],
  "effectClassifications": ["MUTATING"],
  "operations": {
    "exhaustive": true,
    "entries": [
      {
        "name": "item_management",
        "title": "Manage property items",
        "summary": "Add items, change optional instance labels, or remove an empty item within one property.",
        "actionClasses": ["CREATE", "UPDATE", "DELETE"],
        "effectClassifications": ["MUTATING", "DESTRUCTIVE"]
      }
    ]
  }
}
```

`operations.exhaustive=true` means that absence from `entries` proves the tool
does not expose another operation in that version. `false` makes the entries
useful routing examples but never evidence that an omitted operation is
unsupported. Operation names and summaries come from the same provider-owned
registry that generates dispatcher schemas and detailed description responses;
parallel handwritten operation lists are forbidden because they can drift.

Each tool therefore publishes:

- a stable machine name and concise title;
- a human-authored selection summary of no more than 400 characters;
- validated selection action and effect classifications;
- a complete execution description stating how and when to use it and what its
  result proves;
- an exact input schema;
- an output schema for structured output;
- truthful read-only, destructive, idempotent, and open-world annotations;
- structured result and error states; and
- server-enforced validation for every business invariant.

Mutation tools are batch-capable by default when the same domain operation can
naturally apply to one or more independently identifiable records. Their exact
schema accepts a bounded collection with a minimum of one item, and a singular
request uses that same tool with a one-item collection. Do not publish separate
singular and batch tools when their authorization, validation, effects, and
result meaning are otherwise the same. A singleton-only mutation requires a
concrete domain or provider reason, such as a unique lifecycle transition, an
interactive workflow boundary, a provider restriction, or materially different
authorization or safety semantics.

The owning domain defines the batch limit, rejects duplicate or conflicting
targets, validates the complete collection, and states whether the operation is
atomic or may partially succeed. It also owns per-item outcomes, idempotency,
retry behavior, concurrency checks, and one truthful receipt for the complete
call. Native mutations are atomic unless their domain contract explicitly
requires another behavior. Batch support must express the domain operation; it
must not be simulated through generic database writes or by making the model
issue one tool call per record.

The selection summary is the routing layer of the Tool Description, not a
clipped execution description. It omits argument-level procedure unless that
procedure determines which tool is appropriate. It must be sufficient for a
model to select probable tools from a catalog while the complete description
and schemas remain deferred.

Every cataloged selection summary ends with a compact, standardized suffix
generated from the tool's validated metadata, for example `Actions: READ.` or
`Actions: CREATE, READ, UPDATE. Effects: MUTATING.` The allowed action classes
are `CREATE`, `READ`, `UPDATE`, `DELETE`, and `EXECUTE`; `EXECUTE` covers sends,
commits, provider operations, and other consequential actions that CRUD does
not describe accurately. Multiple classes are allowed when the tool genuinely
performs more than one kind of operation. Effect classifications distinguish at
least read-only, mutating, destructive, and external effects and remain
consistent with the tool's published annotations. The suffix counts toward the
400-character limit.

The suffix is generated rather than hand-authored so routing prose cannot drift
from the machine-readable contract. Action classes describe the logical result
owned by the tool, not incidental implementation details such as internal SQL
statements. They inform selection but do not grant authorization or weaken any
approval, validation, or provider-owned workflow boundary.

Every native tool must supply a valid Tool Description. Every externally owned
MCP tool should supply one through `_meta["agent-slayer/selection"]` or explicit
source-referenced adapter metadata. Registration and discovery validate
metadata when present; missing or invalid remote metadata is reported
explicitly for correction at the owning boundary. Application-owned metadata
never replaces, rewrites, or broadens a provider-published description, schema,
authorization boundary, or workflow meaning.

Native calendar, contact, to-do, log, email, profile, file, guide, search, and
video tools use the same domain services as their HTTP and UI adapters. Generic
database mutation is limited to an explicit allowlist of transitional tables
whose mutation ownership has been deliberately assigned.

# 4. Schema-semantics compiler

Schemas are inherent contracts of the blocks and boundaries that publish them;
they are not a separate owner. The LLM data protocol owns its schemas, the MCP
protocol carries provider and tool schemas, the search protocol owns its message
schemas, and each MCP or native domain owns the schema and meanings of its data.

The schema-semantics compiler is a separate shared internal tool because it
performs one concrete operation across participating structured database-backed
tools. It is deterministic application code, not an LLM or a model-callable
tool, and it does not become the owner of any schema it processes.

The Tool Description contract answers which tool or provider-owned operation
can produce an outcome. The schema-semantics compiler answers what the selected
structured objects and fields mean. An operations list must never absorb field
semantics or replace an exact compiled schema projection; the compiler must
never infer tool operations from field names.

The compiler owns:

- loading and validating the versioned schema-semantic form;
- accepting an exact operation description naming the participating objects and
  fields;
- combining stored database mechanics with the human-authored meanings for only
  those named objects and fields;
- compiling the smallest exact schema-semantic projection for that operation;
- returning the projection to the participating tool so it can accompany the
  structured result; and
- recording each compiled projection literally in the request trace.

The compiler does not access data rows, choose sources or tools, construct
queries, rank or filter results, authorize access, enforce domain validation,
mutate data, or interpret field meaning. Application code may mechanically use
explicit machine-readable projection fields; the LLM interprets human-readable
meanings supplied with a result.

The current implementation integrates the compiler with participating native
database-backed tools. Use by another block or protocol requires an explicit
integration and trace path; shared availability must not be described as use by
every block when no such integration exists.

# 5. MCP protocol

A protocol is the communication standard at a boundary. Every Agent Slayer
boundary has a named protocol defining what crosses it and how both sides
validate it. The MCP protocol is the boundary between the agent structure and
an MCP. Native tools follow the same protocol inside the application; remote
MCPs follow their published standard contract plus supported Agent Slayer
conventions.

The protocol carries:

- connection and server identity;
- server instructions;
- capability manifests and context-view definitions;
- tool names, titles, concise selection summaries, complete execution
  descriptions, input schemas, and output schemas;
- annotations and tool metadata;
- calls with exact argument objects;
- structured results, errors, and retry descriptors;
- resource links and result metadata;
- effect receipts; and
- opaque provider-owned workflow references.

Orientation receives a bounded capability catalog containing only capability
identity, title, summary, and context views plus each candidate tool's machine
name, concise title, complete validated selection summary, optional bounded
operations, and an explicit status only when Tool Description validation is
missing. Raw annotation objects, representative
tool lists, counts derivable from the list, callable schemas, and execution
descriptions are omitted. Execution receives full guidance, complete execution
descriptions, annotations, and exact schemas only for selected tools. It may
make a bounded request for additional exact tools only inside the accepted
capability families; the application then continues the same execution with a
compact source-referenced projection of earlier receipts. A merely cataloged,
deferred, disabled, disconnected, unauthorized, or failed tool is never
represented as callable.

The continuation projection is the only model-facing form of an earlier
same-request receipt after tool expansion or model-thread replacement. It
integrates tool name, status, canonical arguments, stable receipt event number,
exact filtered evidence, errors, and action references in one object. It removes
duplicate schema contexts, search-filter bookkeeping, provider envelopes, and
other data that does not change the observed evidence. The complete literal
receipt remains once in the durable ledger and trace; it is not copied beside
the compact projection. If exact omitted evidence is still required and receipt
reading is callable, execution pages that stable receipt instead of repeating
the original action.

Initial tool selection is deliberately precise and recoverable. Accepting a
capability family does not make every tool in that family callable, and the
application must not send every schema merely because one of those tools might
be useful. Expansion may reveal exact schemas for named tools, but it does not
add a capability family, broaden the requested work, answer an MCP question, or
confirm a prepared change.

A model tool call is accepted only when its exact schema is present in that
execution interaction. Agent Slayer maps the published upstream name to the
registered application name, validates the complete arguments, invokes that
exact function, and returns its result to the same model exchange.

## One final confirmation

The Agent completes every available preparation and validation step before
asking for final confirmation. An MCP emits the following handoff only when the
work is ready for its final consequential call:

```json
{
  "contractVersion": 1,
  "status": "ready",
  "nextAction": {
    "type": "request_user_confirmation",
    "instruction": "Import 7,987 prepared transactions and leave 23 exceptions unchanged?",
    "onApproval": {
      "tool": "commit_operation",
      "arguments": { "plan_id": "opaque-mcp-id" }
    }
  }
}
```

The `instruction` is the exact plain-language yes-or-no question for the user,
not instructions about how to ask it. The MCP must not emit this handoff while
more non-user preparation remains. Agent Slayer validates and saves the exact
tool and arguments. It then stops work and presents that single question.

The saved state has only two meanings: pending or confirmed. A clear yes in the
next user request marks that exact prepared change confirmed and runs its exact
saved call. A no leaves it unexecuted. The user never sees or supplies a plan
ID, receipt ID, reference, token, or separate authorization. A changed preview
is a different prepared change and requires its own final question; an
unchanged saved preview does not acquire extra confirmation stages.

This handoff is executable protocol, not advisory prose. If an MCP result
declares `requiredAction=REQUEST_USER_CONFIRMATION`, uses
`nextAction.type=request_user_confirmation`, or supplies
`nextAction.onApproval`, then the complete handoff is mandatory:
`nextAction.type`, a nonempty user-facing `instruction`, a same-connection MCP tool,
and arguments valid against that tool's current schema. Agent Slayer validates
those fields before accepting the successful result as pending. A missing or
invalid field is a typed, terminal contract mismatch for the current request.
The full MCP result remains in its immutable receipt, but no pending change is
created, repair cannot retry the preview, and the application reports plainly
that the final question could not be prepared. The user is never asked to
confirm something that the next request cannot execute.

A prepared change first produced during execution is pending for the remainder
of that request. Execution, completion audit, repair, and tool expansion must
not invoke it. The next user request either confirms it or does not. This is an
internal execution boundary, not additional work and not an "authorization
problem." Account login is separate: a real login failure asks the user to
reconnect; a pending change asks only its one concrete yes-or-no question.

Orientation also receives a bounded index of recent durable tool receipts for
the exact recent request IDs. The index contains receipt event number, tool,
status, time, and payload sizes, but no arguments or results. When a
continuation needs an MCP-owned identifier that is absent from conversation
prose or active action references, orientation selects the database capability
and `tool_receipt_read`; execution pages the exact immutable receipt. The user
must never be asked to locate or supply an opaque identifier previously returned
to Agent Slayer. Receipt inspection is evidence and workflow recovery only. It
does not confirm a change or repair a malformed handoff; execution uses the
recovered state with an advertised MCP read, recovery, or preview operation to
produce a valid final question.

An incomplete workflow result carries an explicit status, exact missing fields
or questions, and a structured retry descriptor. Every retry descriptor
validates against the single authoritative, versioned schema at
`config/protocol-schemas/retry-descriptor.v1.schema.json`. That schema, rather
than a provider-specific prose convention, defines the interoperable field
contract. A future incompatible contract requires a new versioned schema and an
explicit protocol-version selection; it must not silently change version 1.

A retry descriptor describes technical retry conditions. It does not authorize
a mutation, schedule a retry, prove that retrying is safe, or replace the owning
tool's validation, atomicity, idempotency, and partial-success contract. Only the
tool or provider that owns the operation may supply its descriptor. Agent Slayer
validates and records the descriptor but does not infer missing provider
workflow semantics from an error message or reason-code name.

`requires_new_client_request_id` refers only to a provider-defined client
request or idempotency identifier explicitly exposed by the tool contract. It
never refers to the Agent Slayer request ID, LLM interaction ID, model tool-call
ID, receipt ID, plan ID, or another correlation ID. `false` means the retry is
the same logical provider operation and must reuse the existing provider client
request ID when one exists. `true` means the provider requires a new logical
provider operation: the old provider client request ID must not be reused, and a
new one is created only when an authorized retry is actually invoked. The trace
keeps the old and new attempts correlated. If the callable tool schema neither
exposes such an ID nor declares an application-managed mapping for one, a `true`
value is unsupported and must not be guessed around.

`preserve_complete_original_batch` states whether a valid retry must resubmit
the complete original batch with corrections instead of only failed, missing,
or changed items. `retry_after_ms` is a minimum provider-directed delay measured
from the recorded result time; `null` means that the provider specified no
delay. Neither field grants authorization or permits an otherwise identical
failed call unless the owning tool's validated retry contract allows it.

For MCPs that publish only the standard contract, the protocol uses their
descriptions, schemas, results, and annotations as published. Provider workflow
state is accepted only through an explicit structured protocol field.

The transport preserves server identity and instructions, tool title, input and
output schemas, annotations, tool metadata, result metadata, and
non-duplicative resource links. Model-visible structured output stays compact;
runtime and trace retain client-only metadata.

## Large artifacts across the Agent Slayer–MCP boundary

MCP's standard JSON-RPC tool calls remain the control plane. They carry compact
structured arguments, progress, opaque identifiers, provider results, and
receipts. They are not the bulk byte-transfer path. Standard MCP resources and
resource links represent data held by an MCP for a client to read; they do not
define a universal resumable upload of a client-local file to a remote MCP.
Client roots may identify local filesystem scope when a client and server can
actually access the same files, but a `file://` URI is not a remote upload and
must never be sent to a server that cannot read that filesystem.

Agent Slayer therefore uses one application-level artifact convention layered
beside MCP Streamable HTTP whenever a remote MCP explicitly opts in. The MCP is
the control plane and the authenticated HTTP artifact endpoint is the data
plane. Both use the same server identity and bearer authorization. Artifact
bytes never pass through the LLM, model tool arguments, model context, or an
MCP JSON-RPC body.

The boundary is deterministic:

- data originating as an uploaded file is normalized into a durable canonical
  artifact and transferred by the artifact path, regardless of that file's
  particular size;
- a small structured object or batch created directly during an interaction may
  use an ordinary MCP tool's JSON arguments;
- unusually large application-created structured data is first persisted as an
  artifact and then follows the artifact path;
- UTF-8 JSON Lines (`application/x-ndjson`) is the canonical file encoding for
  sequences of structured records: one complete JSON object per nonblank line;
- ordinary `application/json` may represent the same records as one top-level
  array when an exact provider tool accepts an inline batch; packaging never
  changes the domain record schema or meaning; and
- provider-to-agent structured results stay compact. A provider returns a
  standard MCP resource link for provider-held files when that is sufficient.
  A large download that needs byte-range resumption uses the same authenticated
  artifact data-plane principle, with a provider-declared URL, size, media type,
  digest, and confirmed byte ranges; an arbitrary URL is never inferred from
  prose or a field name.

An upload-capable provider declares the convention mechanically on the MCP tool
that will consume the completed artifact. Human-readable server instructions
may explain the workflow, but they do not activate transport behavior. The
consumer tool's `_meta` contains:

```json
{
  "agent-slayer/artifactUpload": {
    "contractVersion": 1,
    "transportId": "transaction_import",
    "endpointPath": "/mcp/artifacts",
    "acceptedMediaTypes": ["application/x-ndjson"],
    "maximumChunkBytes": 1048576,
    "maximumBytes": 1073741824
  }
}
```

`maximumBytes` may be `null` when the provider enforces its limit during begin.
`transportId` is unique among one server's advertised artifact consumers.
The consumer tool must require `artifact_id` as a string. Any additional
workflow arguments remain entirely provider-owned; for example, Accounting's
`stage_transaction_import_artifact` also requires `import_job_id`. Agent Slayer
exposes a single application upload function only when this metadata and the
consumer schema validate. It does not infer activation or workflow meaning from
tool names, descriptions, field names, or server prose.

For version 1, Agent Slayer resolves `endpointPath` against the configured MCP
server origin and refuses a cross-origin endpoint. It captures the exact bearer
authorization used by that MCP connection once and uses the same value for
every request in the upload attempt. It verifies the persisted local byte size
and SHA-256 before sending anything. For JSON Lines it also verifies fatal
UTF-8 decoding and one JSON object per nonblank line without placing records in
model context.

The resumable upload sequence is:

1. Begin or recover the durable provider artifact with
   `POST <endpointPath>`, `Content-Type: application/json`, and this body:

   ```json
   {
     "client_request_id": "stable-upload-id",
     "file_name": "canonical-transactions.jsonl",
     "media_type": "application/x-ndjson",
     "byte_size": 5580000,
     "sha256": "64-lowercase-hexadecimal-characters"
   }
   ```

   `client_request_id` is stable for the same provider and whole-file digest.
   An exact replay returns the same provider artifact rather than creating
   another logical upload. The JSON response supplies `artifact_id`.

2. Read authoritative progress with
   `GET <endpointPath>/<artifact_id>`. Its JSON response supplies
   `artifact_id` and `next_offset`. Offset zero is valid. An offset outside
   `[0, byte_size]` is rejected.

3. Send raw bytes with
   `PATCH <endpointPath>/<artifact_id>`, using
   `Content-Type: application/octet-stream`, `Upload-Offset` equal to the
   provider-confirmed offset, and `X-Content-SHA256` equal to the lowercase
   hexadecimal digest of that exact chunk. A chunk never exceeds the smaller of
   the provider-declared limit and 1 MiB. The response confirms the new offset
   through `Upload-Offset` or JSON `next_offset`; Agent Slayer accepts progress
   only when it equals the exact end of the submitted byte range.

4. After every byte is confirmed, call
   `POST <endpointPath>/<artifact_id>/complete`. Then read the artifact state
   again. The completion response may be empty; the subsequent `GET` is
   authoritative. If the progress read already proves the artifact is complete,
   a replay skips the redundant completion call and still performs final
   verification. Completion is accepted only when the provider reports the
   original artifact ID, complete status, media type, byte size, and whole-file
   SHA-256.

5. Return only the compact artifact descriptor and observed transfer totals to
   the model. The model may then call the exact provider consumer tool with its
   already-created logical workflow ID and the returned `artifact_id`.

The provider owns upload persistence, offset truth, chunk replay behavior,
whole-file verification, expiration, and artifact authorization. An exact
chunk replay must be idempotent; gaps, conflicting overlaps, invalid hashes,
and excess bytes are provider errors. A failed Agent Slayer call never claims
completion. Retrying the same application upload function reuses the stable
client request ID and resumes from the provider's current offset.

One upload and all internal chunks are one observable application operation.
The trace records begin, progress reads, byte ranges, chunk hashes, completion,
and the protocol fields used for final verification literally. Arbitrary HTTP
response fields, bearer tokens, and artifact bytes are not copied into transfer
trace events. Successful transfer proves only that the provider durably
received the verified artifact. Parsing, grouping, validation, deduplication,
exception handling, preview, approval, and commit remain owned and proven by
later MCP tools.

Artifact transport failures are classified by application code against the
exact advertised contract, not by model judgment or provider prose. A required
artifact operation returning HTTP 404, 405, 415, or 501 is a contract mismatch.
A successful HTTP response with a missing or invalid artifact ID, offset,
status, media type, size, or digest is also a contract mismatch. HTTP 401 and
403 are authentication failures; 408, 425, 429, other 5xx responses, and
network failures are retryable transport or provider failures; 409 is a
provider state conflict; remaining 4xx responses are provider rejections.

Every classified failure carries a bounded structured descriptor in the tool
result, trace event, and durable receipt: classification, stable code, server,
capability, transport ID, advertised-contract fingerprint, upload step, HTTP
method, path, status, whether it is terminal for the current request, and the
condition under which retry is valid. A contract mismatch is terminal for the
unchanged request. The runtime still performs the conditional completion audit
but mechanically suppresses repair from retrying or substituting a transport,
preserves earlier successful receipts, and appends a direct user-visible status
explaining the failed operation and required integration refresh. The adapter
remembers the failure by server, transport ID, and contract fingerprint across
later requests. Only a successful MCP reconnection and tool rediscovery clears
that block and permits one new attempt against the newly observed integration;
another mismatch blocks it again. Prompt instructions are not the enforcement
mechanism.

# 6. Search engine data protocol

The search engine data protocol standardizes everything entering and leaving
the search engine. JSON is the default encoding; the protocol supplies the
version, field meanings, provenance, bounds, result states, and validation that
JSON alone does not provide.

Every search input contains:

- protocol version, message ID, and Agent Slayer request ID;
- the LLM interaction ID that requested the data;
- one explicit retrieval objective, preserved for traceability and later LLM
  validation but not interpreted or executed by the search engine;
- the original query text plus normalized concepts and filters;
- authorized source, capability, context-view, or tool references;
- requested fields and schema-semantics references;
- candidate, evidence, time, and model-token bounds; and
- pagination or continuation state when present.

Every search output contains:

- protocol version and matching correlation IDs;
- `complete`, `partial`, `empty`, or `error` status;
- the normalized query that was executed;
- ranked evidence items with stable source and entity references;
- the matched fields, match reasons, score, and compact returned data;
- candidate, returned, and pruned counts with pruning reasons;
- schema-semantics references used to interpret the evidence; and
- partial-source errors and continuation state.

The query, sources, filters, requested fields, matching options, and limits are
the executable search instructions. The objective is not. The application keeps
the objective correlated with the result so the requesting LLM can determine
whether the mechanically retrieved evidence answers it.

The versioned implementation schema is authoritative. Its basic shape is:

```json
{
  "protocol": "agent-slayer.search-data",
  "version": 1,
  "messageId": "search-message-id",
  "requestId": "agent-request-id",
  "objective": "Find evidence that answers one retrieval question",
  "query": {
    "text": "original query text",
    "concepts": [],
    "filters": []
  },
  "sources": [],
  "semanticsRefs": [],
  "limits": {
    "candidates": 100,
    "evidence": 20,
    "modelTokens": 2000
  }
}
```

```json
{
  "protocol": "agent-slayer.search-data",
  "version": 1,
  "messageId": "search-message-id",
  "requestId": "agent-request-id",
  "status": "complete",
  "executedQuery": {},
  "evidence": [
    {
      "sourceRef": "stable-source-reference",
      "entityRef": "stable-entity-reference",
      "score": 0,
      "matchedOn": [],
      "matchReasons": [],
      "data": {}
    }
  ],
  "summary": {
    "candidates": 0,
    "returned": 0,
    "pruned": 0,
    "prunedByReason": {}
  },
  "semanticsRefs": [],
  "partialErrors": [],
  "continuation": null
}
```

Search protocol messages and validation results are recorded literally. Large
source records remain behind their stable references; model context receives
the compact evidence selected by this protocol.

# 7. LLM data protocol

The LLM data protocol standardizes everything entering and leaving an LLM
interaction. It keeps instructions, the exact user request, context, state,
capabilities, and output requirements as separately typed fields instead of one
undifferentiated prompt.

Every LLM input contains:

- protocol version, interaction ID, Agent Slayer request ID, type, and stage;
- one explicit objective;
- the exact user request in its own field;
- bounded instructions for that interaction;
- source-referenced context items with type and capture time;
- accepted structured state such as the TurnBrief and bound approvals;
- either a capability catalog or exact callable tool schemas, according to the
  interaction stage;
- the exact output schema; and
- model, input, output, time, and tool-call limits.

Every LLM output contains:

- protocol version and matching correlation IDs;
- one discriminated status: `final`, `structured_output`, `tool_calls`,
  `needs_information`, or `error`;
- the payload required by that status;
- exact tool names and arguments for `tool_calls`;
- exact missing fields or questions for `needs_information`;
- source references supporting reported information; and
- validation errors when the output does not match the interaction contract.

The model adapter appends the provider response ID, model identity, token usage,
estimated cost, latency, and validation result from observed runtime data.

The versioned implementation schema is authoritative. Its basic shape is:

```json
{
  "protocol": "agent-slayer.llm-data",
  "version": 1,
  "interaction": {
    "id": "interaction-id",
    "requestId": "agent-request-id",
    "type": "orientation",
    "stage": "orient",
    "objective": "Produce a valid TurnBrief"
  },
  "userRequest": {
    "exactText": "the user's exact request"
  },
  "instructions": [],
  "context": [],
  "state": {},
  "capabilities": {
    "catalog": [],
    "callableTools": []
  },
  "outputSchema": {},
  "limits": {}
}
```

```json
{
  "protocol": "agent-slayer.llm-data",
  "version": 1,
  "interactionId": "interaction-id",
  "requestId": "agent-request-id",
  "status": "structured_output",
  "payload": {},
  "toolCalls": [],
  "missingInformation": [],
  "sourceRefs": [],
  "validationErrors": []
}
```

The protocol records the exact typed input, exact provider-visible callable
schemas actually sent, provider-visible request, normalized output, validation
result, and usage as separate literal trace events. Registry definitions or
intermediate candidate sets that were not sent are not substituted into an
event labeled as provider-visible.

Each provider-visible tool-schema event records the exact sent tool names and
schemas, their count, and their serialized schema byte size. Candidate and
deferred tool names, counts, or compact summaries may be recorded separately so
the trace can explain selection without duplicating unsent schemas.

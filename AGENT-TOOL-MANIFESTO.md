Agent Slayer uses the following building blocks to turn natural speech into
efficient, authorized tool use. Each heading is a positive, comprehensive list
of the responsibilities owned by that building block - meaning if the block owns the responsibility it should take care of it, and also if the responsibility is not in the block, the block should not do it at all. Numbered system terms are defined in  `AGENT-TERMINOLOGY.md`.

# Object Oriented Agenting

The product models the real world through three connected parts:

- **Nouns — objects:** User-referable things such as accounts, events, tasks,
  properties, and people, each owned by a domain.
- **Verbs — tools:** The actions a domain makes available to read or change its
  objects.
- **Adjectives — descriptions:** Names, currencies, dates, files, text fields,
  and join-table relationships that qualify or connect objects. Some may also
  be objects in their own right.

This is the organizing principle for the agent's architecture: domains define
what things are and what can be done with them; the agent brings those meanings
together in one conversational interface.

## Object identity invariant

No stable object binding means no object has been identified. The normative
runtime representation is the versioned
`config/protocol-schemas/first-class-object-binding.v1.schema.json`. It is the
center of one first-class object identity protocol suite: an Object Description
declares how domain records produce their ID, reference, and display fields;
the runtime binding carries the resulting exact identity and evidence; and an
object-input binding declares where a tool consumes that bound ID or reference.
These contracts are linked, but they remain separate producer, instance, and
consumer shapes so none has to duplicate the others' data.

Whenever the application or model resolves, selects, returns, or later refers
to a first-class object, it preserves one compact binding containing:

- the compact contextual role the object fills in the current request or
  provider workflow;
- the domain-qualified object type and owning source;
- the provider-native primary ID and stable reference;
- the human-facing display name; and
- source event numbers proving where that binding was observed.

The ID and stable reference are the machine identity. The display name is the
human identity. Neither substitutes for the other and neither may be discarded:
an ID without type, source, display, and evidence is meaningless context for a
person, while a name without an ID and stable reference is only search text and
must never become an action target. Qualifiers remain available through the
owning read path when the request needs more than identity.

An ID's scalar type is part of its identity and must remain exact across tool
results, bindings, schemas, and later arguments. Native database primary keys
are positive integers, including when a database driver initially returns their
decimal representation as text. Genuinely opaque provider IDs remain strings.
The application never treats the string and integer forms as interchangeable at
an action boundary and never performs a lossy numeric conversion.

A native stable reference must belong to the same declared object type as its
ID and display. When one returned record describes a primary object and a
related object, the primary object's generic reference must not be reused for
the related object; the related type uses its own declared reference or its
type-specific stable reference prefix. A persisted binding whose native
reference belongs to another declared type is rejected, never rewritten into a
new identity.

Object bindings are bulk-shaped even when they contain one object. A later
interaction copies the exact binding; it does not regenerate an ID from prose,
rediscover an already identified object by name, silently choose the first
candidate, or substitute a conventional value such as `1`. Singleton tools
require exactly one bound object. Batch tools receive the complete intended
set. If no verified binding resolves the user's mention, the object remains
unresolved until an authorized read identifies it.

Request completion and object evidence are independent. A request that pauses
for missing information or otherwise remains incomplete does not invalidate an
exact binding produced by a successful read or mutation. Later context retains
those canonical observations while withholding selections that were merely
mentioned in orientation and never independently observed during the request.
A failed or uncertain operation never becomes successful identity evidence.

The common-sense core names supplied stable references and exact selectable
sets rather than copying full bindings. It may define request-local object sets
from supplied references and directed relationship sets from supplied endpoint
pairs. After orientation the application hydrates those references from its
verified catalog and verifies explicit composer selections through their named
read-only resolver. This deterministic step is recorded in the trace, never
adds an unselected object, never silently shrinks an intended batch, and never
turns an exact relationship set into two independent object lists.

These bindings are priority context, not context bloat. Context pruning removes
bulky records and repeated prose before it removes the compact ID/reference/
display binding. Referenced exchanges and accepted orientation records carry
bindings forward literally. Binding an object does not authorize an operation, make a
tool callable, or bypass freshness and domain validation; it makes the target
exact.

Role is use-site context, not another identity and not provider business logic.
It distinguishes same-type objects that are not interchangeable, such as a
statement account and a designated suspense account, or the destination and
sources of a contact merge. Reassigning a role never changes an object's ID,
reference, display, source, or evidence. Tool contracts assign any specialized
use-site role during execution; later interactions preserve that role with the
binding.

## Native domain consistency invariant

Every Agent Slayer-owned native domain presents one coherent data surface to
the user and the agent. A domain may preserve specialized business behavior,
but it must not create a weaker parallel implementation for one caller.

Mutable domain relationships expose exact batch-shaped link and unlink
operations together. Unlinking names the exact edges to remove and never
requires the caller to reconstruct or replace every sibling relationship.
Whole-set replacement may remain available when replacing the set is itself a
real domain operation, but it is not the sole deletion path for individual
edges.

### Data operability contract

The **data operability contract** is the high-level completeness index for every
user-managed first-class native resource and every resource presented through
an Agent Slayer-owned MCP. The agent must be able to do the following in a
systematic way:

1. **Discover** — know that the resource exists, which domain or provider owns
   it, and which operations and limitations are available.
2. **Search** — find user-referable objects through the one application search
   coordinator, using domain-owned providers and explicitly selected searchable
   fields.
3. **Identify** — preserve the canonical domain-qualified type, owning source,
   provider-native ID, stable reference, human display, freshness evidence when
   needed, and source evidence for every identified object.
4. **Read** — retrieve authoritative records through bounded reads with useful
   filters, deterministic ordering, limits, pagination or continuation, and
   explicit complete, partial, empty, and error states without silent
   truncation.
5. **Create, read, update, and delete or archive** — expose the complete
   meaningful lifecycle for every user-managed object instead of an a la carte
   selection of whichever operations happened to be implemented first.
6. **Relate** — store durable typed relationships and expose exact link, read,
   relationship-attribute update, and unlink operations without requiring
   reconstruction of sibling edges.
7. **Operate in batches** — use bounded batch-shaped reads and mutations by
   default, represent one item as a one-item batch, and document the concrete
   domain or provider reason for every singleton-only operation.
8. **Preserve correctness** — enforce authorization, complete-batch validation,
   duplicate and conflicting-target rejection, transaction or partial-success
   semantics, optimistic concurrency where stale writes matter, idempotency,
   replay behavior, and safe retry rules.
9. **Explain outcomes** — return literal per-item results, effects, failures,
   continuations, and mutation receipts rather than inferring success from
   prose.
10. **Represent lifecycle semantics** — state timestamps, units, status
    transitions, relationships, and the exact meaning of deletion, archival,
    cancellation, disabling, provider ownership, and immutable history.
11. **Work at scale** — keep large records and datasets behind stable
    references and move or process them through bounded artifacts rather than
    copying them through model context or issuing one call per record.
12. **Remain auditable** — record discovery, reads, mutations, approvals,
    external effects, receipts, retries, and failures in a linear literal trace.
13. **Stay consistent across surfaces** — agent tools, MCP tools, HTTP adapters,
    and interactive UI use the same owning domain and search services and
    preserve the same identity, authorization, result-state, and mutation
    semantics.
14. **Describe the contract mechanically** — publish identity, ownership,
    lifecycle operations, relationship operations, batch shape, effects,
    schemas, result states, retry behavior, and limitations through versioned
    machine-readable contracts, with bounded human guidance only where it adds
    domain meaning.

For native data, capability resource declarations are the exhaustive operability
matrix. Agent Slayer-owned MCPs publish the same facts through their resource,
Object Description, object-input binding, Tool Description, and discovery
contracts. An operation is explicitly available, intentionally unsupported for
a concrete reason, visibly unimplemented, or provider-managed; omission is not
a fifth state and never proves that the operation is unavailable. An unrelated
third-party MCP may expose less metadata, but the catalog reports that limitation
instead of inventing completeness or silently treating absence as support.

Native data architecture is resource-centric and must remain resource-centric.
The resource lifecycle declaration is the source of truth; a hand-curated list
of tools is not. Every first-class native object is declared exactly once in
its owning capability package with all four lifecycle cells: create, read,
update, and delete or archive. Every physical native join table is declared
exactly once as a relationship resource with link, read, attribute-update, and
unlink cells. A cell either names its exact owning tool and batch shape, is
intentionally unsupported for a concrete domain, provider, or immutable-history
reason, or is explicitly marked as an unimplemented gap. A gap is visible debt,
not an assertion that the domain forbids the operation. Absence is never an
unsupported-operation declaration.

Repository verification compares these declarations with the canonical native
object catalog and every physical join table in the baseline schema, and checks
that every local first-class object type has one global-search provider owner.
Startup then verifies that every supported lifecycle cell resolves to a
registered tool, every declared array batch points to a bounded nonempty input
array, and the compiled Tool Description classifications agree with the
lifecycle. Adding a native object, join table, search provider, or lifecycle
tool without extending these contracts is an incomplete change and must fail
verification. System-managed provenance and provider-owned resources remain
visible as explicit classifications rather than disappearing from the
completeness matrix. Verification reports known unimplemented cells separately
from intentional limitations so neither can be mistaken for full CRUD support.

As specified by the Tool Description contract in section 3A, the application
compiles protocol/version, CRUD action classes, ordinary effects, and default
routing language from the resource lifecycle. For native CRUD this is
compiled output rather than an independent handwritten inventory. Exact
execution descriptions, schemas, result states, authorization, validation,
idempotency, and implementation remain owned by the domain tool.

Consistency means shared envelopes and invariants, not one generic record
schema. The global-discovery rules in section 2B govern agent `global_search`,
native object candidate selection, and direct user search; owning domain tools
retain their exact fields, rich filters, complete records, validation, and
actions. Exact inside-artifact search, identity resolution, duplicate detection,
and other workflow-specific queries remain specialized operations, but they do
not become competing global discovery engines. Connected provider-owned data,
such as live email, participates only through its authorized provider adapter
and reports its actual matching and lifecycle limitations.

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

An LLM call is one round trip to the LLM: one request and its response. A single
response requesting seven tools is one LLM call and seven tool calls. Sending
the tool results to the LLM is another LLM call. A workflow step, tool loop, or
aggregated usage record is not an LLM call; each may contain multiple calls.
All LLM-call counters use round trips, never those aggregates.

Token prices are set only on the AI Usage screen. No environment, server, or
transport defaults supply rates. The browser stores a separate user-entered
price card for each observed provider service tier and for older records whose
tier was not recorded. Each LLM response preserves its provider-reported tier,
and aggregate usage preserves the corresponding per-tier token breakdown.
Without the required price card, no dollar estimate is shown. Historical
estimates in literal traces are evidence of what was recorded then, never a
fallback pricing source. Usage totals count each ledger usage event once and do
not multiply charges by tool or LLM-call counts.

LLM calls are measured individually for input, output, latency, and cost. An
LLM call should do one well-defined language task with the smallest context
that can reliably complete it.

# 2. The agent structure

The agent structure is everything in the agent except the LLM. It is the bridge
between natural speech and efficient tool use.

The agent structure owns:

- request intake and the exact-request record;
- bounded conversation context;
- private account enrichment and shared AI-assisted product enrichment;
- capability catalogs and selection;
- first-class object catalogs, candidate matching, exact object bindings, and
  user-visible references;
- exact tool-schema visibility;
- authorization binding and approval state;
- execution and delivery of each result to the same model exchange;
- request state, persistence, receipts, and final responses;
- orientation, execution-context preparation, execution, audit, and repair;
- a literal chronological trace of every observable step; and
- per-step model usage, tool usage, failures, and timing.

For every request, the structure:

1. preserves the user's exact request;
2. constructs a brief bounded conversation summary and preserves exact current
   composer selections;
3. gives orientation the strict common-sense core output schema;
4. gives orientation concise descriptions of connected capability families,
   without tool names or callable schemas;
5. validates the core's literal temporal facts and supplied stable references;
6. automatically verifies explicit composer selections and reads only the
   other named, bounded, read-only context views selected in the core;
7. deterministically hydrates relevant exact object bindings without another
   model call;
8. gives execution the accepted common-sense core, prepared context, verified
   bindings, and exact schemas for tools in the selected capability families;
9. invokes the exact application function named by a valid model tool call;
10. returns each tool result, including compact bindings for identified
    first-class objects, to the same model exchange; and
11. accepts a final answer after deterministic receipt checks or an exceptional
    semantic audit when those checks are insufficient.

When one model response contains sibling tool calls, execution completes every
still-valid sibling and returns all sibling results through the same provider
response chain. Newly observed bindings become exact identity evidence for
later calls in that exchange. They do not rewrite or refresh provider-owned
tool schemas.

Core validation includes deterministic facts that application code can
prove without interpreting user intent. In particular, a named weekday and a
resolved local calendar date must agree before execution begins. A rejected
date interpretation is visibly corrected once and revalidated; a second failure stops the
request before mutation tools become callable. Source-referenced temporal
targets are carried into participating domain tools, which reject scheduled
timestamps outside the authorized local dates before retaining any mutation.

Context views are small, live, domain-owned reference datasets such as active
contact tags, to-do groups, or journal trackers. Each view is advertised in the
capability catalog, selected through `contextRequests`, read through its owning
domain service, recorded literally, and supplied to execution without another
model call. The exact resolver for explicit composer selections is application-
mandated request metadata and is added automatically rather than spending a
model repair call to request it.

Context views read current tool-owned data for one execution. Account-specific
and shared product enrichment are separate, optional agent layers defined in
section 2E.

The structure improves iteratively from trace evidence. Improvements update
explicit, testable retrieval rules, filters, catalogs, schemas, and interaction
definitions.

# 2A. First-class objects and object search

*Object Oriented Agenting*

The first-class object identity protocol has three linked contracts. The
Object Description is the domain-owned producer declaration, the
first-class object binding is the canonical application-owned runtime instance,
and the object-input binding is the domain-owned consumer declaration. Their
shared domain-qualified `type` joins the producer and consumer to the runtime
binding; its `source` records ownership, and each object's stable `ref` and
provider-native `id` keep the instance exact. The runtime binding schema is
required inside Agent Slayer. An unrelated third-party provider may omit the
producer and consumer metadata, but it then does not participate in automatic
first-class identity continuity.

An object is a user-referable entity owned by a domain, such as a contact, a
personal to-do, or a particular journal observation. A database row can
represent an entity without qualifying for this agent surface. First-class
object types are an explicit, reviewed subset of domain-owned tables or
provider-owned entities. Each type needs a stable reference, a useful compact
display, selected searchable words, an authorized read path, and a reason a user
would refer to that entity in conversation. Object eligibility is never inferred
from the presence of a table, primary key, or `sourceOfTruth` annotation.

The native Journal illustrates the distinction. `journal1_groups` rows are
named parents such as the sibling groups Exercise and Biometrics;
`journal2_trackers` rows are the reusable tracked subjects within those groups,
such as Running or Push-ups under Exercise;
`journal3_entries` rows are the dated observations recorded under a tracker.
These are three levels of one Journal object family. Personal to-dos likewise
have named groups and individual tasks. A contact's tags may help match or
describe that contact, but tags and tag assignments are not separate
first-class objects in this surface. Video scripts and content groups are first-class because native tools
consume their stable IDs and the group owns its explicit automatic-sequencing setting; numbered content items are first-class because users
refer to the durable items returned by the owning sequence read.
Things groups and physical items are likewise first-class: the group is the
stable organizational parent, while each item is a durable possession that can
be connected to exact to-dos, content, files, and contacts through constrained
domain-owned joins.

For a native object type, the catalog names its authoritative database table,
primary key, selected columns for matching and display, and declared
relationships. One row in that table is one object. Search reads those selected
columns directly through the owning domain's authorized read path; it may join
bounded related data, such as a contact's tags, to match or display the primary
object. A compact result shape formats the returned row for the user or model;
it is not a second object record. A materialized projection or search index
must have a stated need that direct database reads cannot meet, measured
benefit, an owner, update and freshness rules, access checks, and a fallback to
the database's truth. Search does not default to every field of every row or a
generic database dump.

Object matches retain the owning source, provider-native primary ID, stable row
reference, human-facing display name, matched fields, freshness, and
authorization scope. Related objects come through declared
domain relationships, with bounded reads and the same access checks as the
primary object. An object reference narrows what the user and agent are
discussing; it does not make a tool callable, authorize a mutation, or bypass
the owning tool's validation.

The native interactive object network reads local adjacency through the
read-only `object_relationship_edges` view. That non-materialized projection
normalizes every physical join table plus explicitly reviewed direct native
relationships, emits each edge in both directions, and retains its source table,
source key, family, qualifier, ordering, timestamp, and domain attributes. The
owning tables and tools remain authoritative. The view does not infer that an
endpoint is first-class, authorize a write, perform recursive traversal, or
replace an immutable relationship reference set; application code filters the
declared object types, applies a hard result bound, and hydrates each surviving
object through its owning read.

While the user composes a request, every canonical object card exposes the same
selection checkbox, and the persistent Agent composer shows the bounded total
selected for the next request. The checked source cards remain the sole object
visualization while selection is in progress; the composer does not duplicate
them. The client submits each selection's matching domain type, owning source,
provider ID, stable reference, and display name as bounded request metadata,
and the server validates every exact tuple before accepting the request. The
optional draft-only `@` picker uses the same selection metadata while also
inserting a visible inline mention for prose composed that way. A derived index is considered only if direct reads
prove inadequate under the conditions above. Deterministic candidate matching
does not decide what the user meant. UI candidates enter orientation as explicit
user language, not verified evidence. After orientation, the application
automatically rereads every explicit selection through the named bounded
selection resolver and stops before execution if any exact tuple is unavailable.
Other fresh object evidence enters execution only through bounded context views
selected in the core or through an exact callable read tool during execution.
Retrieved evidence passes through the search engine before it enters later
model context. The LLM decides what the user meant; the application verifies
identity.

A checked computed RRULE calendar occurrence retains one additional typed
selection qualifier: its exact original UTC occurrence start. The recurring
master remains the first-class calendar-event identity and tool-bound object;
the qualifier identifies which generated occurrence of that master the user
checked. Selection deduplication uses the master reference plus this qualifier,
so multiple checked occurrences of one series remain distinct. The server
validates the compact qualifier and rereads the master before execution. It
does not retain arbitrary card-detail prose, and the qualifier neither creates
a new first-class object nor authorizes a calendar mutation.

The interaction surface may also present the durable request history as an
object stream beside the complete conversation view. Each interaction shows the
hat or accepted capability family that performed the work, followed by bounded
cards for the exact first-class objects recorded in domain activity events or
returned by successful reads. Symbols distinguish created, changed, removed,
and used objects. This is a presentation of existing receipts and domain-owned
records: it does not infer effects from assistant prose, turn a tool into an
object, or replace the literal conversation and trace.

## 2A.1. Object Description contract

Every Agent Slayer-owned domain publishes each user-referable first-class
object type it supports as metadata on an authoritative read-only tool. Native
domains publish application-owned metadata from one reviewed native object
catalog; Agent Slayer-owned MCPs publish provider-owned metadata. Both use the
same single versioned contract:
`config/protocol-schemas/object-description.v1.schema.json`, published in that
tool's `_meta["agent-slayer/objects"]`. The enclosing tool is the read path;
the metadata is a catalog, not an object instance, a callable tool, or evidence
that a particular record exists. This is the producer contract: its declared
identity, reference, and display fields populate `objects[].id`,
`objects[].ref`, and `objects[].display` in the canonical
`first-class-object-binding.v1.schema.json` runtime shape. An unrelated
third-party MCP may omit it, but then does not participate in automatic
first-class identity continuity.

A returned object record may carry the reserved `objectRole` field when the
record fills a non-default consumer role. Its value follows the binding role
grammar and enters the runtime binding literally; omission means `subject`.
The field is protected alongside identity, reference, and display during result
filtering. This is structural routing data, not inferred provider semantics.

Each described type has a domain-qualified type ID, title, concise meaning,
optional user-facing aliases, a provider-native identity field, a stable
reference field, a compact human-facing display field, named qualifier fields,
and optional declared relationships to other types. These field names identify
keys in each object item returned by the read tool, even when the tool wraps or
paginates those items. The identity, reference, and display fields are protected
as one binding when results are filtered or projected. The provider defines
those field meanings and supplies actual records through its read tool. Names,
currencies, dates, files, and relationships may
qualify an object without becoming capability families or tools. A type may
have several qualifiers and a read tool may publish several types; one type ID
has only one authoritative read tool within a connection. The read tool must
also publish a valid read-only Tool Description and `readOnlyHint=true`. The
combined published object catalog is limited to 32,768 UTF-8 bytes per MCP
connection so orientation remains bounded.

Discovery validates the schema and these cross-contract rules before replacing
the connection's registered tools. Orientation sees concise owning capability
descriptions; execution receives exact schemas for the selected capability
families. The model must use the returned
record and its stable reference to verify a particular object before making
claims or choosing an action. No object metadata authorizes a read, mutation,
or workflow, and Agent Slayer does not infer provider semantics from field
names or relationships. Provider-owned bounded context views, when available,
still require common-sense core `contextRequests` selection unless they solely
verify explicit composer selections.

## 2A.2. Object-input binding contract

A tool that accepts a first-class object identity publishes domain-owned
`_meta["agent-slayer/object-input-bindings"]` conforming to
`config/protocol-schemas/object-input-bindings.v1.schema.json`. Each entry maps
an exact JSON Pointer in that tool's input schema to a domain-qualified Object
Description type, declares the compact contextual `role` required at that
input, and states whether the input carries its provider ID or stable reference.
This is the consumer contract: `objectType` selects canonical first-class
object bindings with that type and owning source, `role` describes their
intended use-site context, and `value` selects each binding's `objects[].id` or
`objects[].ref`. `*` pointer segments
address every member of an input array. Legacy declarations without `role`
normalize to `subject`. The owning MCP publishes this mapping for remote tools;
the application derives it from the same reviewed native object catalog for
native tools. An application-owned cross-domain adapter, such as an MCP
artifact-upload bridge consuming a native file, publishes an explicit reviewed
mapping to the native catalog rather than inheriting the remote provider's
source. Agent Slayer never guesses it at runtime from names such as
`account_id`, descriptions, or workflow conventions.

The common-sense core uses supplied stable-reference enums but does not copy
provider IDs, human display text, or entire bindings. It may select an
individual reference, select an exact named set, define a request-local set
from supplied references, or describe an unresolved target slot for an owning
read to resolve during execution. After parsing, the application hydrates each
selected reference from the verified catalog. Exact provider tool schemas then
expose provider-owned inputs during execution without repeating them in
orientation.

Discovery rejects an invalid mapping, a missing input-schema path, or an object
type not declared by the same connection or native catalog. Every owned domain
publishes mappings for every tool input that consumes one of its first-class
objects and keeps those mappings in contract tests.

The callable schema remains the owning provider's exact schema. The application
does not inject historical ID enums, treat an orientation selection as an
authorization allow-list, or change the schema after a read. At the call
boundary, every mapped ID or reference must still match a verified binding of
the declared type and owning source. A substituted, guessed, conventional, or
unidentified value such as `1` therefore cannot reach the tool. The verified
object may have been supplied to orientation or observed from its owning read
tool in the same execution. Roles remain compact use-site context for the model
and trace; they do not hide an otherwise verified same-type object from an
exact provider input. An absent optional mapped input remains absent; the
contract does not invent tool arguments or provider workflow. A provider may explicitly mark an
authoritative identifying read as accepting an unbound identity; that exception
lets the read verify an exact user- or application-supplied ID and does not
carry into downstream consuming tools.

For a batch-shaped input every supplied member is checked. An explicit composer
selection remains complete and cannot be silently shortened. Ordinary observed
bindings and orientation-created sets may be used in the exact subset and
shape expressed by the accepted action; a singleton call is not rejected just
because other verified objects of the same type exist. The input contract
enforces identity continuity only. Authorization, freshness, business
validation, and result meaning remain with the owning tool.

## 2A.3. Object and relationship set contract

The normative set shape is
`config/protocol-schemas/reference-set.v1.schema.json`. An object set is a
named immutable snapshot of exact stable object references. A relationship set
is a named immutable snapshot of one relationship type and exact directed
`fromRef` → `toRef` edges. Direction and pairing are data: a relationship set
must never be represented as two lists, expanded into a Cartesian product, or
collapsed by assigning every source to one convenient target.

Orientation receives both individual supplied objects and compact selectable
sets. It may select a supplied set or define a request-local set using only
objects visible in that same orientation interaction. A selected object set
deterministically expands to every member; a selected relationship set expands
to every endpoint while the edge list itself is carried intact into execution.
If exact objects are not yet present, orientation records a bounded unresolved
target slot instead of fabricating a reference. Execution may resolve that slot
through an owning read and continues under the ordinary-language action. When
execution derives a reusable membership or pairing only after those reads, the
exact `reference_set_record` application function validates every endpoint
against current verified bindings and records the resulting canonical set in
the trace. Recording conversational context does not create the corresponding
provider-domain relationship.

Bindings, sets, and relationships have different jobs. A binding proves object
identity. An object set preserves membership. A relationship set preserves
typed correspondence. The accepted common-sense core decides which of those
objects and sets the request applies to. Provider tools decide current validity
and business semantics.

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

Every LLM-directed retrieval path follows this sequence:

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

Agent-facing and direct user-facing global discovery use this same coordinator,
provider catalog, normalization, deduplication, bounds, and partial-source
reporting. Domain-specific search and read tools remain callable for rich
filters and complete native records, but their discovery implementations are
provider adapters behind this coordinator rather than separate global engines.
Native object pickers use an internal coordinator scope and never bypass the
coordinator to create a competing cross-domain search path.

The owning tool publishes the meanings of its inputs and results in its exact
contract. Search code applies explicit structured instructions; the LLM
interprets the returned evidence using those published meanings.

# 2C. Structured problem-solving method

Agent Slayer uses a structured loop derived from the military OODA loop:

1. **Orient** — understand the exact request as ordinary conversation and emit
   a compact common-sense core containing its end state, batch-shaped actions,
   relevant supplied object and set references, exact directed relationship
   sets, unresolved target slots, explicit constraints, genuine questions,
   context needs, and capability families. Do not select exact tools or audits.
2. **Prepare** — deterministically verify explicit selections, read the core's
   bounded context requests, and hydrate exact bindings without another model
   interpretation.
3. **Execute** — receive the accepted core, prepared context, and verified
   bindings; expose exact schemas for the selected capability families; invoke
   tools; and return every result to the same model exchange.
4. **Audit when exceptional** — compare the ordinary-language outcome with
   exact contracts and receipts only when deterministic completion is
   insufficient.
5. **Repair** — correct a concrete audited gap within the user's authorization.
6. **Verify repair** — run another semantic audit over the repaired receipts;
   never accept repair merely because the repair model returned prose.

Typed successful receipts complete ordinary reads and mutations without an
additional model call. Audit is required for destructive-language semantics,
conflicting or failed receipts that may have been recovered, unknown tool
effects, or an action lacking successful mutation evidence. Unknown effects are
treated conservatively.

Completion of an authorized mutation requires a successful receipt for the
exact bound tool and arguments. Status reads and receipt inspection provide
evidence for audit; the exact mutation receipt proves completion.

Tool expansion preserves a source-and-outcome index of same-request receipts.
Bounded continuation context favors recent evidence and uses deterministic
structural summaries for oversized whole values, retaining their source paths
instead of cutting text or inventing meanings. Exact receipts remain available
for recovery. Receipt text pages advance on the original source using the
delivered offset, including when the result filter reduces the page to fit its
serialized envelope; they never recursively page through receipts of pages.

An MCP output-schema mismatch blocks the affected tool until successful tool
rediscovery after provider correction. Such an error does not prove rollback.
The same tool error recurring after a correction stops automatic retries in the
current request. These terminal failures permit a final verification round,
block further mutations, and suppress audit-driven repair. Audit may mark an
already known unresolved blocker as blocked; an incomplete objective alone is
not a reason to repeat the failing operation.

An exact tool-and-arguments call that already failed in the current Agent
request is never executed again. The first identical repeat makes the current
model interaction no-tool: the runtime returns the recorded failure and forces
that interaction to finish instead of permitting another tool-loop iteration.
Completion audit may begin a repair interaction only with a materially
different argument object supported by the receipts, owning tool's retry
contract, and user's authorization; the unchanged call remains blocked.

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

Capability-scoped guidance is not an additional Tool Description layer. It may
coordinate several tools, establish cross-tool selection policy, interpret
ordinary user language, and state when another capability owns part of the
request. It may reference exact published tool behavior when that is necessary
to explain the coordination, but it cannot create, replace, broaden, or weaken
a tool's selection summary, execution description, schemas, annotations, result
states, or owning implementation. Those meanings remain authoritative at
layers 3 through 10 below.

Repository-owned guidance may be stored as a separate human-readable file, but
the capability manifest is its sole declaration and must reference it exactly.
The application validates every declared guidance source at startup and rejects
missing, duplicate, or undeclared sources. Parallel filename maps or fallback
guidance registries are forbidden because they can drift from the capability
manifest. User-authored procedures remain domain data rather than application
capability guidance.

Every native capability is one filesystem package at
`config/capabilities/<capability-id>/`. The package contains exactly
`capability.json` and `guidance.md`. Its manifest conforms to
`config/protocol-schemas/capability-manifest.v1.schema.json`, its directory name
equals its stable ID, and its `guidance` field names the sibling guidance file.
For a capability that owns native data, the same manifest owns its complete
resource lifecycle declarations. Object declarations reuse the canonical
Object Description identity instead of duplicating it; relationship
declarations name their authoritative physical join and endpoints when those
endpoints are user-facing.
The shared loader is the only native manifest discovery path. Startup rejects
schema failures, missing or extra package files, empty guidance, duplicate
identity, and conflicts between connected tool annotations and manifest
expectations. No central JavaScript manifest array or parallel guidance map may
duplicate these packages.

A capability package is the architectural unit a person reads to understand why
a family exists and how its tools coordinate. It is not the implementation of
those tools. Each native tool still publishes layers 1 through 9 in the module
that registers its layer-10 implementation. The registry may validate and
assemble those owned fields, but it must not attach semantic contracts by
recognizing a machine name in a central map.

Versioned schemas and their shared validators are the structural source of
truth. No individual native tool is the semantic source of truth for other
native tools. `daily-paper` and `daily_paper_generate` are the smallest complete
reference package and focused-tool example; new work may copy their shape, but
never inherits their domain meaning, schemas, authorization, result claims, or
effects.

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

Layers 1 and 2 form the compact tool index visible for every connected
capability family in orientation. Layers 3 through 5 are expanded for the
families the deterministic router found plausible and for families selected by
a context-informed orientation pass. This progressive disclosure never hides a
connected family or tool identity and never represents a deferred tool as
callable. Layers 6 through 9 are shown only when the exact tool becomes callable
in execution. Layer 10 never becomes model context; the model observes only its
published contracts and results.

Every Tool Description validates against the single authoritative versioned
schema at
`config/protocol-schemas/tool-description.v1.schema.json`. Native tools publish
the description in their owned registration. An MCP may publish the same object
in its standard tool `_meta` field under the extension key
`_meta["agent-slayer/selection"]`; a third-party application adapter may
instead supply explicit source-referenced metadata when that provider cannot
publish the extension itself. Agent Slayer validates either source identically
and never silently truncates an execution description into a selection summary.

For native tools, “owned registration” means the Tool Description declaration
is in the same implementation module that registers the callable function. A
repository-wide name-to-description map is forbidden.

Native Object Description producers, unbound identifying reads, and
role-specific object inputs follow the same ownership rule: the registering
module opts into them explicitly. The shared native object ontology remains the
structural vocabulary for type identity, ID fields, references, displays, and
relationships. The capability-owned resource lifecycle explicitly maps those
types and relationships to operations. The registry compiles against that
mapping and never guesses lifecycle support from a tool's machine name, SQL
verb, or field spelling. Internal registration declarations never enter the
provider-facing tool definition.

The MCP extension is an Agent Slayer interoperability contract, not a claim
that base MCP requires this field. Every tool published by an Agent Slayer
owned MCP must have a valid Tool Description before its connection can be
accepted or refreshed. Owned providers are identified by their declared MCP
server identity, including user-managed connections with arbitrary local
names. An unrelated third-party tool lacking it may remain connected for
compatibility, but its catalog entry explicitly says that Tool Description
metadata is missing; Agent Slayer does not invent provider meaning or present
a clipped execution description as validated routing evidence.

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

Each tool therefore publishes the following model-facing contract. For native
resource lifecycle tools, the resource declaration compiles the repetitive
items; for provider tools and non-lifecycle workflows, the provider continues
to publish them directly:

- a stable machine name and concise title;
- a selection summary of no more than 400 characters, generated for ordinary
  native lifecycle routing and augmented only by human-authored domain
  distinctions when needed;
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

Read tools that support independent lookups use bounded query batches, with a
single lookup expressed as a one-query batch. Owning tools accept useful date
ranges and identifier sets so the model need not issue one lookup per date or
record. Each query has a correlated result and explicit pagination: a page
limit returns a continuation for remaining matches, never silently truncates
the requested dataset.

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

Every native and Agent Slayer owned MCP tool must supply a valid Tool
Description. Unrelated third-party MCP tools should supply one through
`_meta["agent-slayer/selection"]` or explicit source-referenced adapter
metadata. Discovery validates published metadata before replacing registered
tools; missing owned metadata rejects that connection, while missing
third-party metadata is reported explicitly in the catalog. Application-owned
metadata never replaces, rewrites, or broadens a provider-published
description, schema, authorization boundary, or workflow meaning.

Each owned provider keeps contract tests beside its implementation. Those
tests validate every published Tool Description, Object Description, and
object-input binding against
the versioned schemas, the read-only annotation and effect agreement, unique
object type IDs, provider-native identity fields, stable references and display
fields in representative read results, mapped input-schema paths, and the tool
named as each object's read path. Agent Slayer keeps
consumer tests for discovery, orientation, exact schema selection, tool-result
return, and third-party compatibility. A provider change to these contracts
must update and pass its provider tests and the relevant agent consumer cases.

Native calendar, contact, to-do, journal, email, profile, file, guide, search, and
video tools use the same domain services as their HTTP and UI adapters. Generic
database mutation is limited to an explicit allowlist of transitional tables
whose mutation ownership has been deliberately assigned.

# 4. Database documentation and tool field contracts

Each native domain owns the schema and meanings of its data. MariaDB table and
column COMMENT clauses document storage meaning at its source. The baseline
and reviewed migrations version those comments with the schema. Longer notes,
relationships, and view documentation live beside their SQL definitions.

The Tool Description contract owns model-facing meanings: layer 6 describes
behavior and result interpretation, layers 7 and 8 describe input/output fields,
and layer 10 enforces authorization, validation, and mutation invariants.
Reusable field contracts live with the owning tools. Do not copy storage
catalogs into orientation, append schema explanations to ordinary results, or
introduce a generated semantic form or synchronization dependency.

The read-only database_schema tool exposes live MariaDB comments when explicitly
called. Database compatibility checks remain read-only and independent of
human-authored prose. Comments never authorize access or enforce business rules.

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

Orientation receives a bounded capability catalog containing capability
identity, title, summary, and context views plus every connected tool's machine
name and concise title. Plausible routed families additionally contain each
tool's complete validated selection summary, optional bounded operations, and
an explicit status only when Tool Description validation is missing. A
context-informed orientation expands those details for the families selected
by the first pass. Raw annotation objects, duplicate tool listings, counts
derivable from the list, callable schemas, and execution
descriptions are omitted. Execution receives full guidance, complete execution
descriptions, annotations, and exact schemas only for selected tools. It may
make a bounded request for additional exact tools only inside the accepted
capability families; the application then continues the same execution with a
compact source-referenced projection of earlier receipts. A merely cataloged,
deferred, disabled, disconnected, unauthorized, or failed tool is never
represented as callable.

An unavailable integration is reported in health and its tools are excluded
from the connected capability catalog and execution schemas. Its failure does
not make unrelated connected capabilities or the core service unavailable.
When the user explicitly invokes an unavailable integration hat, the agent
reports that limitation rather than substituting another domain's tools.

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

The same exact prepare/confirm/execute contract may be used by an
application-owned native tool only when its registration explicitly opts into
the confirmation handoff. Its `onApproval.tool` must resolve to a current
native tool and its arguments must validate against that tool's exact schema.
This opt-in does not make ordinary native results executable handoffs.

The Agent completes every available preparation and validation step before
asking for final confirmation. An MCP or explicitly opted-in native tool emits
the following handoff only when the work is ready for its final consequential
call:

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

This handoff is executable protocol, not advisory prose. If an eligible result
declares `requiredAction=REQUEST_USER_CONFIRMATION`, uses
`nextAction.type=request_user_confirmation`, or supplies
`nextAction.onApproval`, then the complete handoff is mandatory:
`nextAction.type`, a nonempty user-facing `instruction`, a callable tool on the
same provider connection or native registry, and arguments valid against that
tool's current schema. Agent Slayer validates
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

That application upload function consumes one native `files.file` binding in
the `artifact_source` role. Native transforms and partitions mark only their
intended output files with that role, keeping original inputs and exception
files distinct without copying file contents into model context.

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
- requested fields and owning tool-contract references;
- candidate, evidence, time, and model-token bounds; and
- pagination or continuation state when present.

Every search output contains:

- protocol version and matching correlation IDs;
- `complete`, `partial`, `empty`, or `error` status;
- the normalized query that was executed;
- ranked evidence items with stable source and entity references;
- the matched fields, match reasons, score, and compact returned data;
- candidate, returned, and pruned counts with pruning reasons;
- owning tool-contract references used to interpret the evidence; and
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
- accepted structured state such as the common-sense core, exact bindings, and
  bound approvals;
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
    "objective": "Produce a valid common-sense core"
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

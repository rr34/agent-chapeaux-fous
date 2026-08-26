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
- a concise catalog when it must select capability families; and
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
- bounded conversation context and durable user enrichment;
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
4. gives orientation an organized catalog of connected capability families;
5. validates the TurnBrief;
6. reads only the named, bounded, read-only context views selected in the
   TurnBrief;
7. gives execution the accepted TurnBrief, prepared context, and every exact
   callable schema;
8. invokes the exact application function named by a valid model tool call;
9. returns each tool result to the same model exchange; and
10. accepts a final answer only after the required completion checks.

Context views are small, live, domain-owned reference datasets such as active
contact tags, to-do groups, or log trackers. Each view is advertised in the
capability catalog, selected through `contextRequests`, read through its owning
domain service, recorded literally, and supplied to execution without another
model call.

Durable enrichment stores user-specific meaning such as aliases or learned
interpretations. Context views read current tool-owned data for one execution.

The structure improves iteratively from trace evidence. Improvements update
explicit, testable retrieval rules, filters, catalogs, schemas, enrichment, and
interaction definitions.

# 2B. Search engine / filter / pruner

The search engine finds candidate information and reduces it to the smallest
useful evidence set for the current interaction.

Every time an LLM requests data, it produces a valid search-protocol request.
Every retrieved dataset passes through the search engine before any of that data
enters subsequent LLM context. This rule applies even when the retrieved dataset
is already small and the filter determines that nothing needs to be removed.

The search engine owns:

- source selection from advertised read capabilities;
- bounded candidate retrieval;
- query construction, normalization, matching, ranking, and deduplication;
- pruning facts known not to answer the request;
- preserving stable source references and partial-result metadata;
- enforcing context-size and result-count limits;
- selecting exact schema-semantic projections needed to interpret results; and
- reporting retrieval quality, omissions, and noise for later improvement.
does search engine own all this or is this the responsibilty of the prompt to the LLM to utilize the search engine and the search engine just empowers the LLM to accomplish all this?

Every retrieval path follows this sequence:

1. choose a source likely to contain the answer;
2. retrieve a bounded candidate set through the source's owned read path;
3. interpret fields through the data schema and schema semantics;
4. filter, rank, and deduplicate the candidates;
5. prune unrelated fields and records; and
6. return compact evidence with source references.

Provider-native search accesses provider-owned data. The Agent Slayer search
layer turns those bounded provider results into request-specific model context.

The search engine is built on top of the schema-semantics compiler where
structured data is involved. The compiler supplies deterministic field meaning;
the search engine applies that meaning to retrieval, ranking, filtering, and
pruning.

# 2C. Structured problem-solving method

Agent Slayer uses a structured loop derived from the military OODA loop:

1. **Orient** — preserve the exact request, gather and filter bounded context,
   select capability families, request required context views, describe the
   intended outcome, and declare completion and audit needs in the TurnBrief.
2. **Execute** — receive the accepted TurnBrief and prepared context, expose
   exact callable schemas, invoke tools, and return every result to the same
   model exchange.
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

Each tool publishes:

- a stable machine name and concise title;
- a description stating when to use it and what its result proves;
- an exact input schema;
- an output schema for structured output;
- truthful read-only, destructive, idempotent, and open-world annotations;
- structured result and error states; and
- server-enforced validation for every business invariant.

Native calendar, contact, to-do, log, email, profile, file, guide, search, and
video tools use the same domain services as their HTTP and UI adapters. Generic
database mutation is limited to an explicit allowlist of transitional tables
whose mutation ownership has been deliberately assigned.

# 4A. MCP protocol

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
- tool names, titles, descriptions, input schemas, and output schemas;
- annotations and tool metadata;
- calls with exact argument objects;
- structured results, errors, and retry descriptors;
- resource links and result metadata;
- effect receipts; and
- opaque provider-owned workflow references.

Orientation receives a bounded capability catalog. Execution receives full
guidance and exact schemas only for selected capabilities. A merely cataloged,
disabled, disconnected, unauthorized, or failed tool is never represented as
callable.

A model tool call is accepted only when its exact schema is present in that
execution interaction. Agent Slayer maps the published upstream name to the
registered application name, validates the complete arguments, invokes that
exact function, and returns its result to the same model exchange.

A provider-owned preview or plan uses this preferred structured handoff:

```json
{
  "contractVersion": 1,
  "status": "ready",
  "nextAction": {
    "type": "request_user_confirmation",
    "instruction": "Describe the exact preview and ask for confirmation.",
    "onApproval": {
      "tool": "commit_operation",
      "arguments": { "plan_id": "opaque-provider-id" }
    }
  }
}
```

The protocol validates that `tool` is an upstream tool on the same connection
and that `arguments` match its current schema. Agent Slayer records the opaque
reference with its source receipt. A later orientation may select it when the
current request authorizes it, and execution may invoke the bound tool only with
the bound arguments.

An incomplete workflow result carries an explicit status, exact missing fields
or questions, a structured retry descriptor, and whether the complete original
batch must be preserved.

For MCPs that publish only the standard contract, the protocol uses their
descriptions, schemas, results, and annotations as published. Provider workflow
state is accepted only through an explicit structured protocol field.

The transport preserves server identity and instructions, tool title, input and
output schemas, annotations, tool metadata, result metadata, and
non-duplicative resource links. Model-visible structured output stays compact;
runtime and trace retain client-only metadata.

# 4B. Search engine data protocol

The search engine data protocol standardizes everything entering and leaving
the search engine. JSON is the default encoding; the protocol supplies the
version, field meanings, provenance, bounds, result states, and validation that
JSON alone does not provide.

Every search input contains:

- protocol version, message ID, and Agent Slayer request ID;
- the LLM interaction ID that requested the data;
- one explicit retrieval objective;
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

# 4C. LLM data protocol

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

The protocol records the exact typed input, provider-visible request, normalized
output, validation result, and usage as separate literal trace events.

# 5. Data schema

The data schema is executable documentation for stored information. It combines
database mechanics with plain-language field meaning so tools, search, and
people share the same interpretation.

Each data schema defines:

- objects, fields, types, nullability, keys, and relationships;
- plain-language comments for the meaning of each object and field;
- units, formats, enumerations, and time semantics;
- identity, ownership, and lifecycle fields;
- queryable and filterable fields;
- validation and mutation invariants enforced by the owning domain service;
- stable source identifiers used in context and receipts; and
- versioned, reviewable changes.

The schema-semantics compiler combines database mechanics with human-authored
comments and meanings into deterministic projections for exact participating
objects and fields. Structured database tools return the relevant projection
with their results, and the trace records it.

The search engine consumes compiler projections to understand candidate fields,
construct better queries, compare equivalent concepts, rank results, and prune
irrelevant fields before context reaches the LLM.

Schema comments and semantics are code: they are explicit, testable, versioned,
and reviewed with the schema and the search behavior that depends on them.

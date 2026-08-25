# Agent, native tool, and MCP boundary

This document defines the contract Agent Slayer expects from its own native
tools and prefers from connected MCP servers. It is a design convention for
software we control, not a demand the agent can impose on an arbitrary MCP.
External MCPs remain usable through their published standard contracts; when a
stronger convention is absent, Agent Slayer must behave conservatively and must
not guess workflow state, identifiers, or authorization.

## Ownership

Agent core owns:

- exact-request orientation, the TurnBrief, and rolling conversation state;
- capability selection and exact callable-schema visibility;
- binding the user's authorization to one exact callable action;
- tool invocation, bounded result delivery, receipts, trace, and completion audit;
- MCP connection configuration and the mapping from upstream tool names to
  application-callable names.

A native tool or MCP owns:

- its entities, persistence, validation, transactions, and authorization;
- domain defaults, required inputs, batch completeness, and retry safety;
- previews, plans, expiration, revalidation, idempotency, and commit behavior;
- the truth about what its result changed.

Agent core may retain an opaque, source-referenced invocation descriptor. That
descriptor is not a copy of the provider's plan and does not make Agent Slayer
the plan owner.

## Required baseline for every tool

Every native or MCP tool should provide:

1. a stable machine name and concise title;
2. a description that says when to use the tool and what it proves;
3. an exact input schema;
4. an output schema when structured output is promised;
5. truthful effect annotations, especially read-only, destructive, idempotent,
   and open-world behavior;
6. structured success and error results rather than prose-only control signals;
7. server-enforced validation for every business invariant.

Prompt instructions may help the model choose a tool. They are never the sole
enforcement of a data or authorization invariant.

## Capability manifest

Native capabilities declare a manifest. MCP capabilities are assembled from the
connection identity, server title and instructions, and discovered tool
metadata. A manifest may include:

- stable capability ID, title, summary, and aliases;
- capability-scoped guidance;
- tool dependencies;
- attachment hints;
- an optional deterministic context provider for small, live, domain-owned
  context that is already known to be useful whenever the capability executes.

Orientation receives a bounded catalog summary. Full capability guidance and
exact tool schemas are supplied only after that capability is selected.

## Enrichment

Enrichment is deterministic application context added before a model step. It is
not another LLM call and must not become a hidden second implementation of a
tool. Use it only for small, high-value facts that avoid a predictable lookup,
such as the bounded names of active native log trackers.

An enrichment provider belongs to the capability that owns the data. The generic
context builder invokes selected providers and does not query domain tables or
interpret their schemas itself. Prefer an ordinary tool call when the data is
large, conditional, expensive, authorization-sensitive, or needed only for a
minority of requests.

## Provider-guided workflows

The preferred structured result for a provider-owned preview or plan is:

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

`tool` is the upstream tool name on the same MCP connection. Agent Slayer maps
it to the local callable name and validates the complete argument object against
that tool's current input schema. It never accepts a provider result that points
to another connection or a local native tool.

When input is incomplete, return an explicit status, exact missing fields or
questions, and a structured retry descriptor. Batch tools should say whether the
complete original batch must be preserved. These are provider facts, not global
agent assumptions.

MCPs that do not expose this convention still work normally. Their descriptions,
schemas, results, and standard annotations remain available to the model, but no
durable approval reference is synthesized from names such as `planId`,
`preview_request_id`, or `readyToCommit`.

## Authorization and completion

For a provider-guided approval:

1. the provider returns the exact target tool and arguments;
2. Agent Slayer records an opaque reference with the source receipt;
3. orientation may select that reference only when the current user request
   authorizes it;
4. execution may invoke only the bound target tool with the bound arguments;
5. completion requires a successful receipt for that exact invocation.

A status read, receipt inspection, different tool, partial argument match, or
same identifier used with another provider never proves completion.

## Auditing

The TurnBrief decides whether the requested outcome calls for an audit. Runtime
also requires an audit when deterministic findings exist or a successfully
called tool declares effects that merit verification. A single declared
read-only call may skip audit when the TurnBrief does not request one. Unknown
effects are treated conservatively.

Annotations inform this decision; they do not grant authorization and are not a
substitute for receipts.

## Native data paths

Native calendar, contact, to-do, log, email, profile, file, guide, search, and
video data remain Agent Slayer application data. HTTP/UI adapters and model-tool
adapters should call the same domain service wherever they mutate the same
tables. Generic database mutation is not a third business-logic path.

`database_write` is restricted to an explicit allowlist of transitional tables
that have no focused model mutation tool. A new table is not model-writable
until its owner and mutation contract are deliberately assigned.

## MCP transport fidelity

The MCP adapter preserves server identity and instructions, tool title, input
and output schemas, annotations, tool metadata, result metadata, and
non-duplicative resource links. Model-visible structured output stays compact;
client-only metadata remains available to runtime and trace without being
silently discarded.

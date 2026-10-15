# Agent Slayer development boundary

This repository is a normal application, not an agent framework or plugin.

## Core invariant

Every user request must begin with a literal orientation interaction that visibly contains:

1. the user's exact request;
2. a brief, bounded conversation summary plus exact current object selections;
3. the strict common-sense core output schema; and
4. concise descriptions of every connected capability family.

Orientation identifies the ordinary conversational end condition, batch-shaped
actions and targets, explicit constraints, genuine ambiguities, needed context,
and capability families. It does not select exact tools, copy full object
bindings, write generic guard prose, decide audit policy, or maintain a second
protocol-shaped conversation state. The current request and explicit composer
selections outrank older conversational context.

After orientation the application deterministically verifies explicit composer
selections, reads only the core's named bounded read-only context views, and
hydrates exact object bindings without another model interpretation. The
execution interaction must visibly contain the accepted common-sense core,
verified relevant bindings, and the exact schema of every callable tool from
the selected capability families. No mutation or ordinary tool may run before
its exact schema appears in execution.
A model tool call must execute the named application function, and its result
must be returned to the same model exchange before a final answer is accepted.
Every identified first-class object must retain a compact bulk-shaped binding
containing its domain type, owning source, provider ID, stable reference,
human-facing display name, and source evidence. Names alone are search text;
IDs alone lack human context. Exact bindings outrank repeated prose during
context pruning and must be carried into later object use. The normative shape
is `config/protocol-schemas/first-class-object-binding.v1.schema.json`; Object
Descriptions produce it and object-input bindings consume it.
Typed receipts complete ordinary successful work without another model call.
An LLM completion audit is exceptional: use it for destructive-language
semantics, conflicting or failed receipts, unknown tool effects, or missing
mutation evidence. The trace must record orientation, deterministic context
preparation, execution, the audit decision, any repair, and per-step model
usage literally. Never claim that an unavailable or merely cataloged tool is
callable.

## Agent and tool manifesto

Follow `AGENT-TOOL-MANIFESTO.md` when adding or changing model interactions,
context selection, native tools, MCP connections, routing, approval workflows,
receipts, or domain persistence. Use `AGENT-TERMINOLOGY.md` for the numbered
canonical names.
Agent core may select, authorize, invoke, trace, and audit tools, but it must not
recreate provider-owned plans or infer provider workflow semantics from field
names. Business validation and mutation invariants belong to the tool that owns
the data. Generic database writes are default-deny for tool-owned tables.

## Change safety

- Leave changes unstaged unless Nate explicitly requests a Git action.
- Never commit secrets or `.env`.
- Do not deploy or restart services as part of repository work unless Nate
  explicitly requests that live-system action.
- Treat the live MariaDB database as Nate's data. Do not replace, recreate, or
  mutate its schema without explicit approval.
- Run `npm run db:verify` before and after database-dependent changes.
- Keep observability linear and literal. Product users should not need to know
  internal lifecycle terminology to understand a trace.

## Reusable object-card invariant

- Every interactive first-class object surface must render the domain card in
  `web/src/components/object-cards/`. Views may compose cards and provide data,
  controls, actions, and genuinely contextual details; they must not recreate
  or restyle an object's visual representation.
- Put object-specific presentation changes in the named domain card and shared
  layout changes in `SimpleObjectCard`, `FullObjectCard`, or
  `CompactObjectCard`. The only ordinary presentation variants are full and
  compact (expanded and collapsed).
- A property that identifies or characterizes an object in more than one view
  belongs to its reusable card. Keep tests in
  `test/web-domain-object-cards.test.mjs` aligned with this boundary so a new
  view cannot silently fork the representation.
- Print-only documents may use their purpose-built physical-page layout; that
  exception does not authorize a second interactive card design.

# Agent Slayer development boundary

This repository is a normal application, not an agent framework or plugin.

## Core invariant

Every user request must begin with a literal orientation interaction that visibly contains:

1. the user's exact request;
2. the bounded, source-referenced conversation context sent to the model;
3. the strict TurnBrief output schema; and
4. an organized catalog of connected capability families.

The execution interaction must visibly contain the accepted TurnBrief and the
exact schema of every callable tool. Before execution, the application may read
only named, bounded, read-only context views advertised in the orientation
catalog and selected by the TurnBrief's strict `contextRequests` field. No
mutation or ordinary tool may run before its exact schema appears in execution.
A model tool call must execute the named application function, and its result
must be returned to the same model exchange before a final answer is accepted.
The trace must record orientation, execution-context preparation, execution,
conditional completion audit, repair, and per-step model usage literally. Never
claim that an unavailable or merely cataloged tool is callable.

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

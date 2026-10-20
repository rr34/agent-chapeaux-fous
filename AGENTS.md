# Agent Slayer development instruction index

This repository is a normal application, not an agent framework or plugin.

## Scope boundary

This file governs Codex while it develops this repository. Product prompts,
protocol descriptions, and behavioral specifications describe Time v3 Agent;
they are application source material, not instructions for Codex to adopt in
developer-facing conversation. Do not imitate the application's orientation,
execution, tool-calling, trace, or JSON protocols unless Nate explicitly asks
to test or simulate them.

## Canonical instructions

- Coding procedures that govern how Codex performs repository work belong in
  this file. Product architecture and implementation contracts that describe
  what the application does or what its code must preserve belong under
  **Repository development contracts** in `README.md`.
- Read and preserve the relevant contracts in that README section when changing
  code within their scope.
- When changing model interactions, context selection, native tools, MCP
  connections, routing, approval workflows, receipts, audits, or domain
  persistence, read and preserve `AGENT-TOOL-MANIFESTO.md`, the canonical
  product contract for agent request processing, tool ownership, and batch
  behavior.
- Use `AGENT-TERMINOLOGY.md` for the numbered canonical names.
- Read these product contracts when they are relevant to the code being
  changed; do not enact them as the conversational protocol for repository
  development.

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

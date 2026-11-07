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
- Nate personally runs live MariaDB migrations manually on the server. Codex
  must not execute `npm run db:migrate` or otherwise apply a migration to the
  configured database. Prepare and validate the migration code, then hand Nate
  the exact command or runbook. After Nate reports that it completed, Codex may
  run the read-only `npm run db:verify` check.
- Run `npm run db:verify` before and after database-dependent changes.
- The configured test account cannot create or drop the isolated databases used
  by the MariaDB integration suite. For routine verification, run
  `npm run test:unit` and relevant non-database checks; omit `npm test` and
  `npm run test:integration` unless Nate explicitly requests them or confirms
  that a suitably privileged `MARIADB_TEST_*` account is available. Do not
  repeatedly report this known environment limitation as a test failure.
- Keep observability linear and literal. Product users should not need to know
  internal lifecycle terminology to understand a trace.

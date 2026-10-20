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

- Read and follow `README.md` section **Repository development contracts** for
  repository-wide development instructions. Apply its **Change safety** section
  to every task and its other contracts when the affected code falls within
  their scope.
- Put new repository development instructions in that README section under a
  descriptive heading rather than creating another instruction file.
- When changing model interactions, context selection, native tools, MCP
  connections, routing, approval workflows, receipts, audits, or domain
  persistence, read and preserve `AGENT-TOOL-MANIFESTO.md`, the canonical
  product contract for agent request processing, tool ownership, and batch
  behavior.
- Use `AGENT-TERMINOLOGY.md` for the numbered canonical names.
- Read these product contracts when they are relevant to the code being
  changed; do not enact them as the conversational protocol for repository
  development.

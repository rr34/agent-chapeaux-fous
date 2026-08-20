# Agent Slayer development boundary

This repository is a normal application, not an agent framework or plugin.

## Core invariant

The first model interaction for every user request must visibly contain:

1. the user's exact request;
2. the bounded context sent to the model; and
3. the exact schemas of every tool immediately callable in that interaction; and
4. an organized catalog of connected capability families whose detailed schemas
   were deferred.

The model may request a cataloged capability. Before any newly loaded function
can be called, its exact schema must be visible in a continuation of the same
user request. A model tool call must execute the named application function, and
its result must be returned to the same model exchange before a final answer is
accepted. Never claim that an unavailable or merely cataloged tool is already
callable.

## Change safety

- Leave changes unstaged unless Nate explicitly requests a Git action.
- Never commit secrets or `.env`.
- Do not deploy or restart services as part of repository work unless Nate
  explicitly requests that live-system action.
- Treat `data/agent.sqlite` as Nate's data. Do not replace, recreate, or mutate
  its schema without explicit approval.
- Run `npm run db:verify` before and after database-dependent changes.
- Keep observability linear and literal. Product users should not need to know
  internal lifecycle terminology to understand a trace.

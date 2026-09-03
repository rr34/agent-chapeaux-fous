# Provenance

This repository begins with a new history and a standalone runtime design.

Retained product concepts and application-owned work include the Slayer name,
the MariaDB domain model, the web/voice workflow, local transcription, and the
idea of a complete activity ledger. The direct model loop, tool registry, MCP
boundary, request queue, server, web client, and trace presentation in this
tree are standalone application code.

No source files, plugin manifests, configuration files, patch scripts, runtime
clients, or Git history from the previous third-party runtime host are included.
Third-party packages remain governed by their own licenses as recorded by the
package manager.

The application calls the OpenAI Responses API over HTTPS through its local
transport adapter. No OpenAI client or agent source is copied into this
repository.

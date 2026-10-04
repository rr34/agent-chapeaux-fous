# Native capability packages

Each directory is one comprehensible native capability family:

```text
<capability-id>/
  capability.json
  guidance.md
```

`capability.json` is the machine-readable identity and routing contract. It
conforms to `../protocol-schemas/capability-manifest.v1.schema.json` and is the
only declaration of its guidance source, read-only tool hints, cross-capability
tool dependencies, and attachment hints.

`guidance.md` coordinates tools in that capability during execution. It may
explain selection, sequencing, defaults, and another capability's ownership,
but it does not define or override a tool's name, title, selection description,
input/output schemas, annotations, result states, or implementation.

The tool registration beside its implementation owns those tool-specific
contracts. The shared capability loader and versioned schemas—not another
native tool—are the structural source of truth.

Native object producers and object-input roles are likewise explicit in the
owning registration module. Shared ontology data supplies stable object
vocabulary; it does not attach behavior by recognizing a tool name.

`daily-paper` is the smallest complete reference package and its
`daily_paper_generate` registration is the reference focused native tool. They
are examples to copy when adding a capability; other tools never inherit their
domain meaning, schemas, authorization, or effects.

Startup rejects malformed packages, a directory/ID mismatch, missing or empty
guidance, unexpected package files, duplicate IDs or aliases, and declarations
that disagree with registered tool annotations. This keeps the filesystem,
runtime catalog, and execution guidance as one checked architecture.

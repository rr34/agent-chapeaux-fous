# Agent Slayer Terminology

The number is part of each canonical name. A retained term may describe an
excluded, legacy, or future option; its presence here does not claim that the
corresponding feature is callable.

**1. Agent Slayer application** — The standalone Node.js application that
receives requests, constructs context, registers and executes tools, calls the
model transport, records activity, and returns the final response.

**2. OpenAI language model used by the agent** (LLM) — The OpenAI model selected
by `SLAYER_MODEL` and reached through the configured provider-neutral transport.

**3. TLOM MCP server** — TLOM's user-scoped Streamable HTTP MCP endpoint at
`https://mytlom.com/api/mcp`, from which Agent Slayer discovers property,
building, item, manual, and property-task tools.

**4. TLOM API** — TLOM's backend, including the implementation beneath **3.
TLOM MCP server**. It is owned by the TLOM product, not this repository.

**5. Legacy phone-app transcription** — The earlier proposal to use a separate
phone client's transcription path. It is absent from the current system.

**6. Phone-native transcription** — Speech-to-text completed by the phone or
keyboard before text reaches Agent Slayer. It does not preserve original audio
and is not the selected recorded-request path.

**7. Agent-server transcription service** — The local faster-whisper worker
that converts a stored recording into text before the model request.

**8. Direct audio input to the OpenAI model** — Sending original audio to an
audio-capable OpenAI model. It is explicitly excluded from the current design.

**9. Agent Slayer HTTP service** — The loopback Node HTTP server that provides
static files, health, request, voice, trace, and optional MCP OAuth endpoints.

**10. Agent Slayer web client** — The mobile-friendly browser client for typed
input, image/file attachment, recording, request status, API usage/cost,
integration state, and request traces. Its target phone layout puts a large red
voice button first and shows elapsed time plus the current operation for every
active request.

**11. Agent Slayer request queue** — The application-owned strict FIFO worker
shared by typed and recorded requests.

**12. ChatGPT subscription** — A historical concept from the removed
subscription-backed model path. It is separate from **14. OpenAI Platform API
account** billing and is not used by this application.

**13. ChatGPT subscription connection** *(formerly ChatGPT OAuth connection)* —
A historical concept from the removed subscription-backed model path. No such
connection is configured or callable.

**14. OpenAI Platform API account** — The selected separately metered developer
service authenticated with the server-side `OPENAI_API_KEY`. Token usage and
editable cost estimates are visible on the AI Usage screen.

**15. Phone audio recorder** — The browser `MediaRecorder` path that captures an
original microphone recording for upload.

**16. Audio transport** — The authenticated HTTP upload from **10. Agent Slayer
web client** to **48. Voice-ingestion service**. TLS or private-network
publication is supplied by deployment infrastructure.

**17. Agent speech-generation service** — The OpenAI Platform speech service
used server-side for disclosed AI narration in video productions. Ordinary live
Agent responses still use browser-native speech synthesis in the web client.

**18. Phone audio player** — The current web client automatically speaks each
completed response submitted by that browser unless Respond silently was
selected. The preference and pending response IDs survive reloads in browser
storage. Stopping or interrupting playback is not yet implemented.

**19. Agent activity ledger** — The append-only chronological record of
observable request, context, model, tool, response, error, usage, and media
events stored in `activity_events`.

**20. Agent media storage** — The configured filesystem root for original voice
recordings and any future request artifacts, with metadata stored in `files`.

**21. Agent short-term memory service** — The bounded recent-history query used
when constructing context for one request. It is not a separate database.

**22. Agent long-term memory** — Explicit text search over older requests and
responses in the same chronological ledger.

**23. Agent observability system** — Health and per-request trace views derived
from runtime state and **19. Agent activity ledger**, including the compact live
elapsed-time and current-stage display.

**24. TimeV3 MCP server** — A possible controlled TimeV3 tool boundary. It is
retained in the vocabulary but is not currently configured.

**25. Video-production service** — The native domain that packages explicitly
selected completed interactions into a versioned portable script and, when
requested, atomically queues its linked background MP4 job.

**26. Built-in video-render worker** — The single-concurrency background
service that prepares original request audio or disclosed AI narration, then
renders the script's designed Agent-interface reproduction through Remotion.

**27. Portable video-script contract** — The versioned production brief,
generator prompt, grounded scene plan, optional built-in render scene types,
continuity requirements, and negative constraints stored for one script.

**28. Selected-interaction production context** — The bounded, chronologically
ordered, source-referenced request and response evidence prepared only after
orientation selects the advertised video context view.

**29. Content-selection process** — A deferred automated process for choosing
interactions to turn into content.

**30. Content approval queue** — A deferred interface for reviewing, editing,
approving, rejecting, or scheduling generated content.

**31. Social publishing integration** — Deferred connections that would publish
content to external social platforms and record the result.

**32. Telephone provider** — A deferred SIP, Twilio, or similar call transport.

**33. Telephone-answering agent path** — A deferred call-specific workflow
joining a telephone provider, voice handling, Agent Slayer, tools, history, and
speech generation.

**34. TLOM database** — TLOM's private application data store. TLOM owns its
schema, user isolation, authorization, and internal instrumentation.

**35. Agent database** — The externally supplied SQLite snapshot containing
Agent Slayer's ledger, history, files, durable profile facts, personal to-dos,
personal logs, and any compatible domain tables and views.

**36. Publishable-content filter** — The initial video-script boundary that
bounds selected request and response text, redacts recognized secret patterns,
and requires the script interaction to omit unrelated private material. Broader
policy classification remains future work.

**37. Personal communications server** — A deferred authoritative self-hosted
email, calendar, and contacts service.

**38. Independent audit writer** — A deferred separate writer that could make
the activity ledger more resistant to mutation by ordinary application actions.

**39. Agent communications interface** — A deferred controlled interface for
email, calendar, contacts, and related communications.

**40. Public email network** — External mail servers and SMTP delivery outside
a future personal communications server.

**41. Legacy upstream project** — The public project used by the earlier
architecture. It is not a dependency of the current Agent Slayer application.

**42. Upstream contribution workflow** — The retained process for researching
and proposing an issue, test, documentation correction, or patch to an upstream
dependency when explicitly authorized.

**43. GitHub contribution identity** — The user's GitHub account, credentials,
authorship, and permissions used for an authorized public contribution.

**44. Contribution audit trail** — Ledger events connecting an observed issue
to research, a proposal, authorized public activity, feedback, and outcome.

**45. Adobe Premiere bridge** — A deferred desktop integration that could turn
structured video jobs into Premiere projects and exports.

**46. Android voice-client candidate** — A retained category for evaluating a
replaceable native Android voice client. No candidate is part of this runtime.

**47. Private voice web client** *(formerly Tailnet voice web client)* — The
recording-capable portion of **10. Agent Slayer web client**. It can be published
privately through deployment infrastructure but is not coupled to Tailscale. Its
primary control is the large red recording button at the top of the phone
interface.

**48. Voice-ingestion service** — The `/api/voice` path that authenticates and
stores original audio, registers the file, creates a request, and wakes the FIFO
worker.

**49. Schema semantic compiler** — The deterministic schema-explanation package
that combines SQLite mechanics with human-authored meanings. It is pinned as a
dependency and compiles exact projections for structured database operations;
it neither accesses rows nor decides or enforces authorization.

**50. Agent request** — One user input and all processing until exactly one final
user-visible response or error. Internally it is correlated by a request UUID
stored as `turn_id`; “turn” remains a transport or schema mechanic, not the
preferred user-facing term.

**51. Slayer runtime** *(formerly Slayer runtime plugin)* — The application code
that builds the exact model request, records its context and tools, runs the
provider-neutral transport, dispatches requested tools through the registry,
returns each result to the same model exchange, and accepts the final response.
It is not a plugin.

**52. MCP artifact transfer** — The provider-opted-in application function that
verifies one persisted Agent Slayer file and relays its bytes through a remote
MCP's advertised same-origin, bearer-authenticated HTTP artifact endpoint. MCP
tool calls remain the compact control plane; raw resumable HTTP is the bulk data
plane. The provider owns upload state and the opaque resulting artifact.
Transfer proves byte receipt only; it does not infer provider workflow meaning
or prove that a later domain import was validated or committed. The adapter
classifies failures against the advertised contract and blocks unchanged
terminal contract mismatches until successful integration rediscovery.

**53. Chapeaux Fous self-knowledge service** — The native read-only capability
that returns source-referenced facts about Chapeaux Fous's identity and name,
interaction and hats system, request and voice path, deployment boundaries,
current runtime, connected integrations, and live callable-tool inventory. Its
hats facts come from the same versioned catalog as the web manual and derive
current availability from the live registry. It provides operational
self-knowledge, not a claim of human consciousness. Its Tailscale description
documents private publication infrastructure while preserving that the
application itself can observe a request channel but cannot prove which network
proxy carried an individual request.

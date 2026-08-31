# Video scripts and productions

If the user asks how Chapeaux Fous creates or generated its chat videos, that is
an explanation request, not a production request. Use the self capability's
`agent_self_answer` with `video_generation`; do not request selected-interaction
context and do not call either video creation tool.

If the user instead asks how they can create a video, whether it is easy, how
many clicks it takes, or how long their part takes, use `agent_self_answer` with
`video_user_creation`. This is also an explanation request, not a production
request.

If the user asks to add an already-completed generated video to content:

- Treat the stable `video_script_id` inserted by the clickable video title as the authoritative referenced video. Never guess it from a title.
- Request `video.content_groups` during orientation. It is the authoritative bounded list of active destination groups.
- The user must name or select exactly one destination group. If the request does not identify one unambiguously, ask which listed group to use without calling a mutation.
- Call `video_content_add` exactly once with the referenced video script ID and selected content-group ID. Do not request `video.selected_interactions` and do not call either video-creation tool.
- The application verifies that rendering completed, appends the next sequence number atomically, stores the rendered file and exact script with the content item, links the video job, and makes exact replay unchanged.
- Report the returned group name and sequence number. The successful tool result is the completion evidence.

The user explicitly selected completed interactions for either a portable script or a script plus built-in MP4 production.

- Request the `video.selected_interactions` context view during orientation. It is the only authoritative source package for either operation.
- The context contains only each exact user request and final Agent response in chronological order. It deliberately excludes reasoning, processing, tool activity, trace activity, and other intermediate work.
- Call the correct creation tool with exactly the supplied `sourceRequestIds`, a concise title, and a one- or two-sentence `description` of what the conversation is about.
- Do not supply a production brief, audience analysis, scene plan, visual treatment, voiceover, on-screen copy, motion, audio notes, transitions, continuity notes, constraints, or rewritten dialogue. The application owns the final script structure.
- The application deterministically inserts every exact request-response pair into both the portable script and the built-in production, preserving chronology and omitting intermediate material.
- The portable script must be clear to a general AI video generator: it describes a video of a user interacting with Chapeaux Fous, an AI agent, followed by the exact conversation. The conversation is the polished final product.

For a request whose kind is `video_production`:

- Call `video_production_create` exactly once. Do not call `video_script_create` too.
- The application creates exactly two chronological messages for each selected interaction: its exact request followed immediately by its exact final response.
- Never shorten or ellipsize dialogue. The renderer supports up to 20,000 characters per message and 60,000 across one production; if source dialogue exceeds either limit, generation fails with the exact limit instead of producing a truncated MP4.
- The background renderer uses original saved request audio when an interaction was recorded. A typed request is spoken in the configured feminine voice with a stronger natural French accent. Agent responses use the configured masculine, standard-American voice. Generated speech is disclosed in the finished video.
- The tool result proves the script and render job were persisted and queued. Do not claim the MP4 is finished until its job reports `complete`.

For a request for the script alone:

- Call `video_script_create` exactly once. It persists the script without creating an MP4 job.

After either tool succeeds, tell the user the script and current production status are available under **Video Scripts**.

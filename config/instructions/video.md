# Video scripts and productions

The user explicitly selected completed interactions for either a portable script or a script plus built-in MP4 production.

- Request the `video.selected_interactions` context view during orientation. It is the only authoritative source package for either operation.
- Use every selected interaction in its supplied chronological order. Do not substitute, omit, or add conversations.
- Ground every scene in one or more selected request IDs. Preserve actual outcomes and do not invent actions, quotations, demonstrations, tool use, or results.
- Remove secrets and unrelated private material. Include personal details only when essential to the requested story and present in the selected evidence.
- Produce a cohesive production brief, consolidated external-generator prompt, and scene-by-scene plan.
- Keep request, processing/tool activity, and response scenes visually faithful to the Agent interface. This is a designed reproduction, not a claimed screen recording.

For a request whose kind is `video_production`:

- Call `video_production_create` exactly once with the complete script. Do not call `video_script_create` too.
- Give every scene a `renderSceneType` of `intro`, `request`, `activity`, `response`, or `outro`, and non-empty server-narration text.
- Build a coherent chronological sequence. Use request scenes for the user's actual requests, activity scenes for actual processing/tool events, response scenes for actual answers, and intro/outro only for grounded framing.
- Make each request or response scene reference exactly one selected interaction. Represent every selected interaction in at least one request or response scene; activity and framing scenes may reference several sources.
- The background renderer uses original saved request audio when an interaction was recorded. A typed request is spoken in the configured feminine voice with a subtle French accent. Agent dialogue and narration use the configured masculine, standard-American voice. Generated speech is disclosed in the finished video.
- The tool result proves the script and render job were persisted and queued. Do not claim the MP4 is finished until its job reports `complete`.

For a request for the script alone:

- Call `video_script_create` exactly once. It persists the script without creating an MP4 job.

After either tool succeeds, tell the user the script and current production status are available under **Video Scripts**.

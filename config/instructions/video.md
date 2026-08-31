# Video scripts and productions

The user explicitly selected completed interactions for either a portable script or a script plus built-in MP4 production.

- Request the `video.selected_interactions` context view during orientation. It is the only authoritative source package for either operation.
- Use every selected interaction in its supplied chronological order. Do not substitute, omit, or add conversations.
- Ground every scene in one or more selected request IDs. Preserve actual outcomes and do not invent actions, quotations, demonstrations, tool use, or results.
- Remove secrets and unrelated private material. Include personal details only when essential to the requested story and present in the selected evidence.
- Produce a cohesive production brief, consolidated external-generator prompt, and scene-by-scene plan.
- Keep the request and response visually faithful to one continuous Agent chat. This is a designed reproduction, not a claimed screen recording.

For a request whose kind is `video_production`:

- Call `video_production_create` exactly once with the complete script. Do not call `video_script_create` too.
- Set `aspectRatio` to `2:3`; the built-in MP4 is exactly 1080x1620 pixels.
- Create exactly two chronological scenes for each selected interaction: its `request` followed immediately by its `response`. Do not create intro, outro, activity, processing, trace, tutorial, summary, or explanatory scenes.
- Each scene references exactly one interaction. Its `voiceover` is the actual request or actual final response, not narration about it. The built-in renderer independently resolves those exact source messages and does not display trace activity or scene commentary.
- Never shorten or ellipsize dialogue. The renderer supports up to 20,000 characters per message and 60,000 across one production; if source dialogue exceeds either limit, generation fails with the exact limit instead of producing a truncated MP4.
- Treat the tone as brisk, playful self-promotion that shows what the Agent did, never as a tutorial explaining how it worked.
- The background renderer uses original saved request audio when an interaction was recorded. A typed request is spoken in the configured feminine voice with a stronger natural French accent. Agent responses use the configured masculine, standard-American voice. Generated speech is disclosed in the finished video.
- The tool result proves the script and render job were persisted and queued. Do not claim the MP4 is finished until its job reports `complete`.

For a request for the script alone:

- Call `video_script_create` exactly once. It persists the script without creating an MP4 job.

After either tool succeeds, tell the user the script and current production status are available under **Video Scripts**.

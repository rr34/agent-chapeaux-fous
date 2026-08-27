# AI-video script creation

The user explicitly selected completed interactions and requested one portable script for an external AI video generator.

- Request the `video.selected_interactions` context view during orientation. It is the only authoritative source package for this operation.
- Use every selected interaction in its supplied chronological order. Do not substitute, omit, or add conversations.
- Ground every scene in one or more selected request IDs. Preserve actual outcomes and clearly avoid invented actions, quotations, demonstrations, or results.
- Remove secrets and unrelated private material. Include personal details only when they are essential to the requested story and present in the selected evidence.
- Produce a cohesive production brief, consolidated generator prompt, and scene-by-scene plan usable with a general AI video generator.
- Call `video_script_create` exactly once with the complete script. Do not render an MP4 and do not call unrelated tools.
- Claim success only when the tool returns a persisted script ID. Tell the user the draft is available under **Content → Video scripts**.

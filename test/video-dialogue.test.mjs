import assert from "node:assert/strict";
import test from "node:test";
import { videoDialogueText, videoSpeechText } from "../src/video-dialogue.mjs";

test("video dialogue omits machine references while preserving useful human text", () => {
  const source = [
    "In reference to:",
    "Task: Address medical bills and call 614-566-1456 on Mon, 31 Aug 2026.",
    "Reference code: personal_task_id=418; request_id=123e4567-e89b-42d3-a456-426614174000",
    "",
    "Please help me decide what to say.",
  ].join("\n");

  assert.equal(
    videoDialogueText(source),
    "In reference to: Task: Address medical bills and call 614-566-1456 on Mon, 31 Aug 2026. Please help me decide what to say.",
  );
});

test("video dialogue removes legacy identity JSON and opaque tokens without removing ordinary code", () => {
  const source = [
    "Generated video “Morning routine”:",
    "{",
    "  \"video_script_id\": 12,",
    "  \"video_job_id\": 34,",
    "  \"output_file_id\": 56,",
    "  \"content_id\": null,",
    "  \"title\": \"Morning routine\"",
    "}",
    "UUID 123e4567-e89b-42d3-a456-426614174000 and token abcdefghijklmnop1234567890abcdef.",
    "Keep task #418, 2026-08-31, https://example.com/abcdefghijklmnop1234567890abcdef, and `const count = 3`.",
  ].join("\n");

  const projected = videoDialogueText(source);
  assert.match(projected, /Generated video “Morning routine”:/u);
  assert.doesNotMatch(projected, /video_script_id|123e4567|abcdefghijklmnop1234567890abcdef\./u);
  assert.match(projected, /task #418/u);
  assert.match(projected, /2026-08-31/u);
  assert.match(projected, /example dot com, path abcdefghijklmnop1234567890abcdef/u);
  assert.match(projected, /const count = 3/u);
  assert.doesNotMatch(projected, /`/u);
});

test("video dialogue converts Markdown into speakable plain text", () => {
  const source = `# Result

This is **important** and [documented](https://example.com/docs).

1. Alpha
2. Beta

- [x] shipped
- [ ] reviewed

| Name | State |
| --- | --- |
| Build | ready |

\`inline code\`

\`\`\`js
const ready = true;
\`\`\``;

  const projected = videoDialogueText(source);
  assert.equal(
    projected,
    "Result. This is important and documented. Item 1: Alpha. Item 2: Beta. "
      + "Completed item: shipped. Not completed item: reviewed. Table with columns Name, State. "
      + "Row 1: Build; ready. inline code. The response included a js code block.",
  );
  assert.doesNotMatch(projected, /[#*`\[\]|]/u);
});

test("the final speech boundary independently removes Markdown", () => {
  assert.equal(
    videoSpeechText("## Status\n\nUse **the safe path** and [open it](https://example.com)."),
    "Status. Use the safe path and open it.",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { markdownToSpeech } from "../public/markdown.js";

test("Markdown speech removes visual syntax while preserving its meaning", () => {
  const speech = markdownToSpeech(`# Result

This is **important** and [documented](https://example.com/docs).

- first choice
- second choice`);

  assert.equal(speech, "Result. This is important and documented. first choice. second choice.");
  assert.doesNotMatch(speech, /[#*\[\]]/);
});

test("Markdown speech describes ordered lists, task state, tables, and code naturally", () => {
  const speech = markdownToSpeech(`1. Alpha
2. Beta

- [x] shipped
- [ ] reviewed

| Name | State |
| --- | --- |
| Build | ready |

\`\`\`js
const ready = true;
\`\`\``);

  assert.match(speech, /Item 1: Alpha\./);
  assert.match(speech, /Item 2: Beta\./);
  assert.match(speech, /Completed item: shipped\./);
  assert.match(speech, /Not completed item: reviewed\./);
  assert.match(speech, /Table with columns Name, State\./);
  assert.match(speech, /Row 1: Build; ready\./);
  assert.match(speech, /I included a js code block in the written response\./);
  assert.doesNotMatch(speech, /const ready|```/);
});

test("bare Markdown links become pronounceable instead of punctuation-heavy URLs", () => {
  assert.equal(
    markdownToSpeech("See <https://www.example.com/help-center>"),
    "See example dot com, path help center.",
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const picker = fs.readFileSync(new URL("../web/src/components/ObjectMentionInput.tsx", import.meta.url), "utf8");
const references = fs.readFileSync(new URL("../web/src/object-references.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("the Agent composer searches and groups native objects after @", () => {
  assert.match(app, /<ObjectMentionInput/);
  assert.match(picker, /\/api\/native-objects\/search\?q=\$\{encodeURIComponent\(query\)\}&limit=48/);
  const labels = [
    "Contacts", "Events", "To-dos", "Routines", "Files", "Journal",
    "Check-in", "Library and video", "Profile",
  ];
  for (let index = 1; index < labels.length; index += 1) {
    assert.ok(picker.indexOf(`\"${labels[index - 1]}\"`) < picker.indexOf(`\"${labels[index]}\"`));
  }
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /role="option"/);
  assert.match(picker, /role="group"/);
  assert.match(picker, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(picker, /event\.key === "Enter" \|\| event\.key === "Tab"/);
  assert.match(picker, /event\.key === "Escape"/);
});

test("a chosen object remains visible and submits its exact identity tuple", () => {
  assert.match(picker, /mention: descriptiveObjectMention/);
  assert.match(references, /`@\$\{boundedDisplay\}\$\{suffix\}`/);
  assert.match(references, /— \$\{label\} #\$\{String\(id\)\}/);
  assert.match(picker, /type: candidate\.domainType/);
  assert.match(picker, /source: candidate\.source/);
  assert.match(picker, /ref: candidate\.ref/);
  assert.match(picker, /detail: candidate\.detail/);
  assert.match(app, /const selectedObjectCandidates = selections\.flatMap/);
  assert.match(app, /detail: _detail/);
  assert.match(server, /normalizeSelectedObjectCandidates\(body\.selectedObjectCandidates\)/);
  assert.match(server, /selectedObjectMentionsAreVisible\(text, selectedObjectCandidates\)/);
});

test("selected identities render as inline objects with hover details", () => {
  assert.match(picker, /className="mention-highlight-layer"/);
  assert.match(picker, /className="mention-inline-token"/);
  assert.match(picker, /className="mention-object-popover" role="tooltip"/);
  assert.match(picker, /popover\.selection\.detail/);
  assert.match(picker, /setSelectionRange\(start, end\)/);
  assert.match(app, /setSelections\(\[\]\)/);
  assert.match(picker, /A request can reference up to \$\{maximumObjectReferences\} objects/);
  assert.match(references, /maximumObjectReferences = 500/);
});

test("the composer retains its cursor when an external reference control takes focus", () => {
  assert.match(picker, /onSelectionChange: \(selection: \{ start: number; end: number \}\) => void/);
  assert.match(picker, /onSelect=\{\(event\) => onSelectionChange/);
  assert.match(picker, /onBlur=\{\(event\) => \{\s*onSelectionChange/);
  assert.match(picker, /onSelectionChange\(\{ start: cursor, end: selectionEnd \}\)/);
});

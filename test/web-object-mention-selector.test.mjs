import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const picker = fs.readFileSync(new URL("../web/src/components/ObjectMentionInput.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("the Agent composer searches and groups native objects after @", () => {
  assert.match(app, /<ObjectMentionInput/);
  assert.match(picker, /\/api\/native-objects\/search\?q=\$\{encodeURIComponent\(query\)\}&limit=48/);
  const labels = [
    "Contacts", "Events", "To-dos", "Routines", "Files", "Journal",
    "Briefings", "Check-in", "Library and video", "Profile",
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
  assert.match(picker, /mention: `@\$\{candidate\.title\}`/);
  assert.match(picker, /type: candidate\.domainType/);
  assert.match(picker, /source: candidate\.source/);
  assert.match(picker, /ref: candidate\.ref/);
  assert.match(app, /selectedObjectCandidates: selections\.map/);
  assert.match(server, /normalizeSelectedObjectCandidates\(body\.selectedObjectCandidates\)/);
  assert.match(server, /selectedObjectMentionsAreVisible\(text, selectedObjectCandidates\)/);
});

test("the picker is draft-only and selected identities can be removed", () => {
  assert.match(picker, /className="mention-bindings"/);
  assert.match(picker, /Remove \$\{selection\.display\} from this request/);
  assert.match(picker, /onSelectionsChange\(selections\.filter\(\(\{ ref \}\) => ref !== selection\.ref\)\)/);
  assert.match(app, /setSelections\(\[\]\)/);
  assert.match(picker, /A request can reference up to \$\{maximumSelections\} objects/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const stateSource = fs.readFileSync(
  new URL("../web/src/components/State.tsx", import.meta.url),
  "utf8",
);

test("the active React client uses no blocking browser dialogs", () => {
  assert.doesNotMatch(appSource, /window\.(?:alert|prompt|confirm)\s*\(/);
  assert.doesNotMatch(appSource, /\b(?:alert|prompt|confirm)\s*\(/);
});

test("application errors remain selectable and directly copyable", () => {
  assert.match(stateSource, /<pre tabIndex=\{0\}>\{message\}<\/pre>/);
  assert.match(stateSource, /navigator\.clipboard\.writeText\(message\)/);
  assert.match(stateSource, /Copy error/);
  assert.match(appSource, /generationError && <ErrorState/);
  assert.match(appSource, /submitError && <ErrorState/);
});

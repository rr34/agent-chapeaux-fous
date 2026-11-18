import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../mobile/src/api.ts", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../mobile/src/storage.ts", import.meta.url), "utf8");

test("the mobile app pairs for an individual revocable device credential", () => {
  assert.match(api, /\/api\/device\/pairings/u);
  assert.match(api, /\/api\/device\/pairings\/token/u);
  assert.match(app, /PAIR THIS PHONE/u);
  assert.match(app, /Account → This profile → Linked devices/u);
  assert.match(storage, /device-credential/u);
  assert.doesNotMatch(app, /Paste your server token/u);
});

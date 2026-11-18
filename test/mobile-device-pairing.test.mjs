import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../mobile/src/api.ts", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../mobile/src/storage.ts", import.meta.url), "utf8");
const authApp = fs.readFileSync(new URL("../web/src/AuthApp.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("the mobile app signs in at the auth host and receives an individual revocable device credential", () => {
  assert.match(api, /\/api\/device\/pairings/u);
  assert.match(api, /\/api\/device\/pairings\/token/u);
  assert.match(api, /verificationUriComplete/u);
  assert.match(app, /auth\.timev3tech\.com/u);
  assert.match(app, /Linking\.openURL\(started\.verificationUriComplete\)/u);
  assert.match(app, /OPEN TIME V3 SIGN-IN/u);
  assert.match(server, /verificationUriComplete/u);
  assert.match(server, /\/api\/auth\/device\/authorize/u);
  assert.match(authApp, /Link this phone/u);
  assert.match(authApp, /timev3technologyagent:\/\/auth\/complete/u);
  assert.match(storage, /device-credential/u);
  assert.doesNotMatch(app, /Paste your server token/u);
});

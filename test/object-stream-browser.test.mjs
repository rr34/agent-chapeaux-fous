import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Agent keeps conversation and object presentations as peer tabs", () => {
  assert.match(html, /id="object-stream-tab"[^>]+role="tab"/);
  assert.match(html, /id="conversation-tab"[^>]+role="tab"/);
  assert.match(html, /id="object-stream-view"[^>]+role="tabpanel"/);
  assert.match(html, /id="conversation-stream-view"[^>]+role="tabpanel"/);
  assert.match(app, /setAgentPresentation\("objects"\)/);
  assert.match(app, /setAgentPresentation\("conversation"\)/);
  assert.match(app, /--topbar-height/);
  assert.match(styles, /\.agent-presentation-switch\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /top:\s*calc\(var\(--topbar-height/);
});

test("object interactions render hats and literal object activity without assistant prose", () => {
  assert.match(app, /function objectInteractionNode\(request, index\)/);
  assert.match(app, /renderAgentMascot\(entry\.querySelector\("\.object-interaction-mascot"\), hats\)/);
  assert.match(app, /"object-interaction-reply reference-in-agent secondary compact"/);
  assert.match(app, /replyButton\.addEventListener\("click", \(\) => replyToExchange\(request\.requestId, request\.request\)\)/);
  assert.match(app, /request\.objectActivity/);
  assert.match(app, /object\.symbol/);
  assert.match(styles, /\.activity-object-card\[data-action="created"\]/);
  assert.match(styles, /@keyframes object-card-enter/);
});

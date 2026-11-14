import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const accountSource = fs.readFileSync(
  new URL("../web/src/components/AdditionalScreens.tsx", import.meta.url),
  "utf8",
);
const authSource = fs.readFileSync(new URL("../web/src/AuthApp.tsx", import.meta.url), "utf8");
const handleInputSource = fs.readFileSync(
  new URL("../web/src/components/HandleInput.tsx", import.meta.url),
  "utf8",
);
const contactEditorSource = fs.readFileSync(
  new URL("../web/src/components/EditableItems.tsx", import.meta.url),
  "utf8",
);

test("the React account access screen can rediscover integration tools", () => {
  assert.match(accountSource, /<h1>Account<\/h1>/);
  assert.match(accountSource, />Access<\/button>/);
  assert.match(accountSource, /await api\("\/api\/integrations\/mcp\/refresh", \{ method: "POST" \}\)/);
  assert.match(accountSource, /Refreshing tools…/);
  assert.match(accountSource, /"Refresh tools"/);
  assert.match(accountSource, /window\.location\.reload\(\)/);
});

test("the authentication screen hides public account creation when registration is closed", () => {
  assert.match(authSource, /registrationEnabled && mode !== "register"/u);
  assert.match(authSource, /New account registration is currently closed\./u);
  assert.match(authSource, /authRequest<\{ registrationEnabled: boolean \}>\("\/api\/auth\/mode"\)/u);
});

test("managed accounts expose explicit password and contact management", () => {
  assert.match(accountSource, />Set password<\/button>/u);
  assert.match(accountSource, /\/set-password/u);
  assert.doesNotMatch(accountSource, />Reset password<\/button>/u);
  assert.match(accountSource, />Manage contacts<\/button>/u);
});

test("Time v3 handle fields render a fixed prefix outside user input", () => {
  assert.match(handleInputSource, /aria-hidden="true">@<\/span>/u);
  assert.match(handleInputSource, /replace\(\/@\/gu, ""\)/u);
  assert.match(authSource, /placeholder="grandma_neaner"/u);
  assert.doesNotMatch(authSource, /placeholder="@grandma_neaner"/u);
  assert.match(accountSource, /placeholder="your_handle"/u);
  assert.match(accountSource, /placeholder="vince"/u);
});

test("contact editing exposes one unambiguous Time v3 handle type", () => {
  assert.match(contactEditorSource, /<option value="timev3_person">Time v3 handle<\/option>/u);
  assert.doesNotMatch(contactEditorSource, /<option value="handle">/u);
  assert.doesNotMatch(contactEditorSource, />Time v3 person<\/option>/u);
});

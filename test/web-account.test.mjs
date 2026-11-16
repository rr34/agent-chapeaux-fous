import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const accountSource = fs.readFileSync(
  new URL("../web/src/components/AdditionalScreens.tsx", import.meta.url),
  "utf8",
);
const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const authSource = fs.readFileSync(new URL("../web/src/AuthApp.tsx", import.meta.url), "utf8");
const handleInputSource = fs.readFileSync(
  new URL("../web/src/components/HandleInput.tsx", import.meta.url),
  "utf8",
);
const contactEditorSource = fs.readFileSync(
  new URL("../web/src/components/EditableItems.tsx", import.meta.url),
  "utf8",
);
const themeSource = fs.readFileSync(new URL("../web/src/ui-theme.ts", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("the React account access screen can rediscover integration tools", () => {
  assert.match(accountSource, /<h1>Account<\/h1>/);
  assert.match(accountSource, />Access<\/button>/);
  assert.match(accountSource, /await api\("\/api\/integrations\/mcp\/refresh", \{ method: "POST" \}\)/);
  assert.match(accountSource, /Refreshing tools…/);
  assert.match(accountSource, /"Refresh tools"/);
  assert.match(accountSource, /window\.location\.reload\(\)/);
});

test("profile appearance derives the web palette from a browser-local dark base color", () => {
  assert.match(accountSource, /<h2 id="appearance-settings-heading">Interface color<\/h2>/u);
  assert.match(accountSource, /pattern="#\[0-9a-fA-F\]\{6\}"/u);
  assert.match(accountSource, /saveUiBaseColor\(color\)/u);
  assert.match(themeSource, /defaultUiBaseColor = "#0e001e"/u);
  assert.match(themeSource, /luminance <= \.25/u);
  assert.match(themeSource, /localStorage\.setItem\(uiBaseColorStorageKey, normalized\)/u);
  assert.match(themeSource, /"--olive-soft": mix\(base, white, \.86\)/u);
  assert.match(styleSource, /background: var\(--theme-base\)/u);
  assert.match(styleSource, /--accent: var\(--olive-dark\)/u);
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
  assert.match(accountSource, /<form className="managed-account-password"/u);
  assert.match(accountSource, /name="username" autoComplete="username"/u);
  assert.equal(accountSource.match(/autoComplete="new-password"/gu)?.length, 4);
});

test("account access exposes authenticated self-service password replacement", () => {
  assert.match(accountSource, /id="account-password-heading">Password<\/h2>/u);
  assert.match(accountSource, /\/api\/account\/set-password/u);
  assert.match(accountSource, /autoComplete="current-password"/u);
  assert.match(accountSource, /This signs you out on every browser\./u);
});

test("account identity management approves and revokes individually linked devices", () => {
  assert.match(accountSource, />Linked devices<\/h2>/u);
  assert.match(accountSource, /mobile app, or the Google Messages extension/u);
  assert.match(accountSource, /"Link device"/u);
  assert.match(accountSource, /\/api\/node\/devices/u);
});

test("ordinary navigation defaults Contacts back to the signed-in person's list", () => {
  assert.match(appSource, /const go = \(next: string\) => \{[\s\S]*searchParams\.delete\("managedPersonId"\);[\s\S]*setView\(next\);/u);
  assert.match(appSource, /<option value="">My contacts<\/option>/u);
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

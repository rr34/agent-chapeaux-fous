import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const editors = fs.readFileSync(new URL("../web/src/components/EditableItems.tsx", import.meta.url), "utf8");
const account = fs.readFileSync(new URL("../web/src/components/AdditionalScreens.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("Account Access owns complete integration management", () => {
  for (const route of ["/api/integrations/mcp", "/oauth/start", "/oauth/disconnect", "/api/integrations/mcp/refresh"]) {
    assert.match(account, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(account, /Add token integration/);
  assert.match(account, /integration\.toolCount/);
  assert.match(account, /Remove/);
});

test("React exposes journal entry creation and the native agent journal remains declared", () => {
  assert.match(app, />Add entry<\/button>/);
  assert.match(editors, /creating \? "\/api\/journal-entries"/);
  assert.match(editors, /Create a new tracker/);
  assert.match(server, /organizer\.createJournalEntry/);
});

test("React calendar exposes archived search, contact roles, invitations, and permanent deletion", () => {
  assert.match(app, /includeArchived=\$\{includeArchivedSearch\}/);
  assert.match(editors, /\/contact-links/);
  assert.match(editors, /participantRole/);
  assert.match(editors, /\/invite-draft/);
  assert.match(editors, /Delete permanently/);
});

test("React to-dos expose complete group, contact, and sequence management", () => {
  assert.match(app, /resource="todo-groups"/);
  assert.match(app, /\/api\/todo-groups\/reorder/);
  assert.match(app, /\/sequence`/);
  assert.match(app, /assign-next-sequence/);
  assert.match(app, /relatedContactId/);
  assert.doesNotMatch(app, /\/calendar-links/);
  assert.match(editors, /Related contact/);
});

test("React contacts expose bulk actions, tag rename, and duplicate merges", () => {
  assert.match(app, /\/api\/contacts\/bulk/);
  assert.match(app, /\/api\/contacts\/tags\/rename/);
  assert.match(app, /\/api\/contacts\/merge/);
  assert.match(app, /Select all visible contacts/);
});

test("React Library and Files expose their retained lifecycle operations", () => {
  assert.match(app, /resource="content-groups"/);
  assert.match(app, /\/api\/content-groups\/reorder/);
  assert.match(editors, /method: "DELETE"/);
  assert.match(app, /Open content/);
  assert.match(app, /FileMetadataEditor/);
  assert.doesNotMatch(app, /Attach stored/);
  assert.match(app, /genericEntityIdentity\("files", file\)/);
  assert.match(app, /method: "PATCH"/);
});

test("video scripts are absent from React navigation", () => {
  assert.doesNotMatch(app, /\["video-scripts", "Video Scripts"\]/);
  assert.doesNotMatch(app, /view === "video-scripts"/);
});

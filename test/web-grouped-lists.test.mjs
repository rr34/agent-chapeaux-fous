import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

function screenSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`\nfunction ${nextName}`, start);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${nextName} follows ${name}`);
  return appSource.slice(start, end);
}

test("video scripts mirror the grouped Library list by lifecycle status", () => {
  const source = screenSource("VideoScriptsScreen", "FilesScreen");
  assert.match(source, /\["draft", \{ id: "draft", name: "Drafts"/);
  assert.match(source, /\["archived", \{ id: "archived", name: "Archived"/);
  assert.match(source, /<ul className="library-list">/);
  assert.match(source, /<FirstClassObjectCard\s+as="li"/);
  assert.match(source, /type: "video\.script"/);
  assert.match(appSource, /view === "video-scripts"\) screen = <VideoScriptsScreen/);
});

test("files mirror the grouped Library list by stored media kind", () => {
  const source = screenSource("FilesScreen", "GenericScreen");
  assert.match(source, /textKey\(file, "mediaKind"\)/);
  assert.match(source, /document: "Documents", image: "Images", video: "Videos", audio: "Audio"/);
  assert.match(source, /<ul className="library-list">/);
  assert.match(source, /<FirstClassObjectCard\s+as="li"/);
  assert.match(source, /type: "files\.file"/);
  assert.match(appSource, /view === "files"\) screen = <FilesScreen/);
});

test("contacts render list groups for people, organizations, and services", () => {
  const source = screenSource("ContactsScreen", "LibraryScreen");
  assert.match(source, /person: "People", organization: "Organizations", service: "Services"/);
  assert.match(source, /textKey\(contact, "kind"\)/);
  assert.match(source, /<ul className="library-list grouped-contact-list">/);
  assert.match(source, /className=\{`contact-card/);
  assert.match(source, /type: "contacts\.contact"/);
});

test("journal trackers and entries share lists under their persisted journal groups", () => {
  const source = screenSource("JournalScreen", "UsageScreen");
  assert.match(source, /readKey\(tracker, "groupId"\)/);
  assert.match(source, /readKey\(entry, "groupId"\)/);
  assert.match(source, /<ul className="library-list">/);
  assert.match(source, /type: "journal\.tracker"/);
  assert.match(source, /type: "journal\.entry"/);
});

test("grouped list rows have shared and responsive styling", () => {
  assert.match(styles, /\.library-groups/);
  assert.match(styles, /\.library-row-actions/);
  assert.match(styles, /\.first-class-object-card/);
  assert.match(styles, /\.contact-card\.is-inactive/);
});

test("every grouped section puts its group selector in the text-filter card", () => {
  const contacts = screenSource("ContactsScreen", "LibraryScreen");
  const library = screenSource("LibraryScreen", "VideoScriptsScreen");
  const scripts = screenSource("VideoScriptsScreen", "FilesScreen");
  const files = screenSource("FilesScreen", "GenericScreen");
  const journal = screenSource("JournalScreen", "UsageScreen");

  assert.match(library, /selectedGroupId === "all"/);
  assert.match(library, /<SectionSelectFilter label="Group"/);
  assert.match(scripts, /selectedStatus === "all"/);
  assert.match(scripts, /<SectionSelectFilter label="Group"/);
  assert.match(files, /selectedMediaKind === "all"/);
  assert.match(files, /<SectionSelectFilter label="Group"/);
  assert.match(contacts, /selectedKind === "all"/);
  assert.match(contacts, /<SectionSelectFilter label="Group"/);
  assert.match(journal, /selectedGroupId === "all"/);
  assert.match(journal, /<SectionSelectFilter label="Group"/);
  assert.match(styles, /\.section-select-filter/);
  for (const source of [contacts, library, scripts, files, journal]) {
    assert.match(source, /<SectionFilter[^>]*controls=\{(?:<>\s*)?<SectionSelectFilter label="Group"/s);
  }
  assert.match(styles, /\.section-filter-controls/);
});

test("contacts expose a tag filter and combine it with group and text filtering", () => {
  const contacts = screenSource("ContactsScreen", "LibraryScreen");
  assert.match(contacts, /<SectionSelectFilter label="Tag"/);
  assert.match(contacts, /\.includes\(selectedTag\)/);
  assert.match(contacts, /&& matchesSearch\(contact, query\)/);
});

test("contacts hide inactive records by default and identify them when requested", () => {
  const contacts = screenSource("ContactsScreen", "LibraryScreen");
  assert.match(contacts, /const \[selectedStatus, setSelectedStatus\] = useState\("active"\)/);
  assert.match(contacts, /selectedStatus === "all" \|\| textKey\(contact, "status"\) === selectedStatus/);
  assert.match(contacts, /<SectionSelectFilter label="Status"/);
  assert.match(contacts, /<option value="active">Active<\/option><option value="all">All records<\/option>/);
  assert.match(contacts, /\.\.\.\(status !== "active" \? \[status\] : \[\]\)/);
  assert.match(contacts, /contact-card\$\{status !== "active" \? " is-inactive" : ""\}/);
  assert.match(styles, /\.contact-card\.is-inactive/);
});

test("persisted group headers expose the shared editor while synthetic groups do not", () => {
  const todos = screenSource("TodoScreen", "ContactsScreen");
  const library = screenSource("LibraryScreen", "VideoScriptsScreen");
  const journal = screenSource("JournalScreen", "UsageScreen");
  const scripts = screenSource("VideoScriptsScreen", "FilesScreen");
  const files = screenSource("FilesScreen", "GenericScreen");

  assert.match(todos, /resource: "todo-groups"/);
  assert.match(library, /resource: "content-groups"/);
  assert.match(journal, /resource: "journal-groups"/);
  assert.match(todos, /group-heading-title/);
  assert.match(library, /group-heading-title/);
  assert.match(journal, /group-heading-title/);
  assert.doesNotMatch(scripts, /group-edit-button/);
  assert.doesNotMatch(files, /group-edit-button/);
  assert.match(appSource, /method: "PATCH"/);
  assert.match(appSource, /`\/api\/\$\{group\.resource\}\/\$\{group\.id\}`/);
  assert.ok(serverSource.includes("const journalGroupMatch = /^\\/api\\/journal-groups\\/(\\d+)$/.exec(url.pathname);"));
  assert.match(serverSource, /organizer\.renameJournalGroup/);
  assert.match(styles, /\.group-edit-button/);
});

test("video scripts are the last workspace section before AI usage", () => {
  assert.match(
    appSource,
    /\["journal", "Journal"\], \["video-scripts", "Video Scripts"\],\s*\["payments", "Payments"\], \["ai-usage", "AI Usage"\]/,
  );
});

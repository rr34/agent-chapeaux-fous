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
  assert.match(source, /<VideoScriptCard\s+as="li"/);
  assert.match(source, /type: "video\.script"/);
  assert.match(appSource, /view === "video-scripts"\) screen = <VideoScriptsScreen/);
});

test("files mirror the grouped Library list by stored media kind", () => {
  const source = screenSource("FilesScreen", "GenericScreen");
  assert.match(source, /textKey\(file, "mediaKind"\)/);
  assert.match(source, /document: "Documents", image: "Images", video: "Videos", audio: "Audio"/);
  assert.match(source, /<ul className="library-list">/);
  assert.match(source, /<FileCard\s+as="li"/);
  assert.match(source, /type: "files\.file"/);
  assert.match(appSource, /view === "files"\) screen = <FilesScreen/);
});

test("contacts render list groups for people, organizations, and services", () => {
  const source = screenSource("ContactsScreen", "LibraryScreen");
  assert.match(source, /person: "People", organization: "Organizations", service: "Services"/);
  assert.match(source, /textKey\(contact, "kind"\)/);
  assert.match(source, /<ul className="library-list grouped-contact-list">/);
  assert.match(source, /<ContactCard/);
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

test("the Journal heading opens a tracker-only editor", () => {
  const source = screenSource("JournalScreen", "UsageScreen");
  const editors = fs.readFileSync(new URL("../web/src/components/EditableItems.tsx", import.meta.url), "utf8");
  assert.match(source, />Add tracker<\/button>/);
  assert.match(source, /<JournalTrackerEditor/);
  assert.match(editors, /export function JournalTrackerEditor/);
  assert.match(editors, /api\("\/api\/journal-trackers"/);
  assert.doesNotMatch(editors.slice(editors.indexOf("export function JournalTrackerEditor"), editors.indexOf("interface PhysicalItemDraft")), /journal-entries/);
  assert.match(serverSource, /organizer\.createJournalTracker/);
});

test("grouped list rows have shared and responsive styling", () => {
  assert.match(styles, /\.library-groups/);
  assert.match(styles, /\.library-list/);
  assert.match(styles, /\.first-class-object-card/);
  assert.match(styles, /\.contact-card\.is-inactive/);
  assert.doesNotMatch(styles, /\.library-row|\.library-sequence/);
});

test("the requested grouped sections put counted one-click filters beside their headings", () => {
  const todos = screenSource("TodoScreen", "ContactsScreen");
  const things = screenSource("ThingsScreen", "LibraryScreen");
  const contacts = screenSource("ContactsScreen", "LibraryScreen");
  const library = screenSource("LibraryScreen", "VideoScriptsScreen");
  const scripts = screenSource("VideoScriptsScreen", "FilesScreen");
  const files = screenSource("FilesScreen", "GenericScreen");
  const journal = screenSource("JournalScreen", "UsageScreen");

  for (const source of [todos, things, library, files, journal]) {
    assert.match(source, /groupFilter=\{<GroupButtonFilter/);
    assert.doesNotMatch(source, /<SectionSelectFilter label="Group"/);
  }
  assert.match(appSource, /role="group" aria-label="Filter by group"/);
  assert.match(appSource, />\{option\.label\} \(\{option\.count\}\)<\/button>/);
  assert.match(appSource, /aria-pressed=\{option\.value === value\}/);
  assert.match(todos, /count: todoGroupCounts\.get\(String\(group\.id\)\) \|\| 0/);
  assert.match(things, /count: thingGroupCounts\.get\(String\(group\.id\)\) \|\| 0/);
  assert.match(library, /count: libraryGroupCounts\.get\(String\(group\.id\)\) \|\| 0/);
  assert.match(files, /count: files\.filter/);
  assert.match(journal, /group\.count \+= 1/);

  // Unrequested synthetic groupings retain their existing selects.
  assert.match(library, /selectedGroupId === "all"/);
  assert.match(scripts, /selectedStatus === "all"/);
  assert.match(scripts, /<SectionSelectFilter label="Group"/);
  assert.match(files, /selectedMediaKind === "all"/);
  assert.match(contacts, /selectedKind === "all"/);
  assert.match(contacts, /<SectionSelectFilter label="Group"/);
  assert.match(journal, /selectedGroupId === "all"/);
  assert.match(styles, /\.heading-group-filter/);
  assert.match(styles, /\.heading-group-button\.is-active/);
});

test("desktop group filters use the heading width and group cards stay horizontally compact", () => {
  assert.match(appSource, /className=\{`page-heading\$\{groupFilter \? " page-heading--grouped" : ""\}`\}/);
  assert.match(appSource, /heading-group-yard/);
  assert.match(styles, /\.page-heading--grouped \{[^}]*display: grid;[^}]*grid-template-columns:/);
  assert.match(styles, /\.heading-group-yard \{[^}]*border-left: 1px solid var\(--line\)/);
  assert.match(styles, /\.heading-group-filter \{[^}]*flex-wrap: wrap/);
  assert.match(styles, /\.todo-group-card, \.library-group-card, \.journal-group-card, \.physical-item-group-card \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto/);
  assert.match(styles, /\.todo-group-card \.first-class-object-content[^}]*display: flex;[^}]*flex-wrap: wrap/);
  assert.match(styles, /\.todo-group-card \.first-class-object-details[^}]*grid-column: auto/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.page-heading--grouped \{ display: flex; \}/);
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
  assert.match(contacts, /attributes: \[\.\.\.contactDetails, \{ label: "Status", value: status \}\]/);
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
  assert.match(todos, /<TodoGroupCard/);
  assert.match(library, /<LibraryGroupCard/);
  assert.match(journal, /<JournalGroupCard/);
  assert.doesNotMatch(scripts, /group-edit-button/);
  assert.doesNotMatch(files, /group-edit-button/);
  assert.match(appSource, /method: "PATCH"/);
  assert.match(appSource, /`\/api\/\$\{group\.resource\}\/\$\{group\.id\}`/);
  assert.ok(serverSource.includes("const journalGroupMatch = /^\\/api\\/journal-groups\\/(\\d+)$/.exec(url.pathname);"));
  assert.match(serverSource, /organizer\.renameJournalGroup/);
  assert.match(styles, /\.group-edit-button/);
});

test("workspace sections use the intended navigation order", () => {
  assert.match(
    appSource,
    /\["agent", "Agent"\], \["search", "Search"\], \["hats", "Hats"\], \["routine", "Routine"\], \["calendar", "Calendar"\],\s*\["journal", "Journal"\], \["contacts", "Contacts"\], \["things", "Things"\], \["todos", "To do"\],\s*\["files", "Files"\], \["content", "Library"\], \["payments", "Payments"\], \["ai-usage", "AI Usage"\],\s*\["video-scripts", "Video Scripts"\]/,
  );
});

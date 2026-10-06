import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
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
  assert.match(source, /<li className="library-row"/);
  assert.match(appSource, /view === "video-scripts"\) screen = <VideoScriptsScreen/);
});

test("files mirror the grouped Library list by stored media kind", () => {
  const source = screenSource("FilesScreen", "GenericScreen");
  assert.match(source, /textKey\(file, "mediaKind"\)/);
  assert.match(source, /document: "Documents", image: "Images", video: "Videos", audio: "Audio"/);
  assert.match(source, /<ul className="library-list">/);
  assert.match(source, /<li className="library-row"/);
  assert.match(appSource, /view === "files"\) screen = <FilesScreen/);
});

test("contacts render list groups for people, organizations, and services", () => {
  const source = screenSource("ContactsScreen", "LibraryScreen");
  assert.match(source, /person: "People", organization: "Organizations", service: "Services"/);
  assert.match(source, /textKey\(contact, "kind"\)/);
  assert.match(source, /<ul className="library-list grouped-contact-list">/);
  assert.match(source, /<li className="contact-row"/);
});

test("journal trackers and entries share lists under their persisted journal groups", () => {
  const source = screenSource("JournalScreen", "UsageScreen");
  assert.match(source, /readKey\(tracker, "groupId"\)/);
  assert.match(source, /readKey\(entry, "groupId"\)/);
  assert.match(source, /<ul className="library-list">/);
  assert.match(source, /journal-tracker-row/);
  assert.match(source, /journal-entry-row/);
});

test("grouped list rows have shared and responsive styling", () => {
  assert.match(styles, /\.library-groups/);
  assert.match(styles, /\.library-row-actions/);
  assert.match(styles, /\.grouped-contact-list \.contact-row/);
  assert.match(styles, /\.journal-tracker-row/);
  assert.match(styles, /\.journal-entry-row/);
});

test("every grouped section exposes its group filter at the top", () => {
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
});

test("contacts expose a tag filter and combine it with group and text filtering", () => {
  const contacts = screenSource("ContactsScreen", "LibraryScreen");
  assert.match(contacts, /<SectionSelectFilter label="Tag"/);
  assert.match(contacts, /\.includes\(selectedTag\)/);
  assert.match(contacts, /&& matchesSearch\(contact, query\)/);
});

test("video scripts are the last workspace section before AI usage", () => {
  assert.match(
    appSource,
    /\["journal", "Journal"\], \["video-scripts", "Video Scripts"\],\s*\["ai-usage", "AI Usage"\]/,
  );
});

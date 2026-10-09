import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsRoot = path.join(root, "web/src/components/object-cards");

test("every visible first-class domain owns a named card component", () => {
  const expected = [
    "ContactCard.tsx", "TodoCard.tsx", "TodoGroupCard.tsx", "CalendarEventCard.tsx",
    "CalendarRoutineCard.tsx", "FileCard.tsx", "LibraryItemCard.tsx", "LibraryGroupCard.tsx",
    "VideoScriptCard.tsx", "JournalTrackerCard.tsx", "JournalEntryCard.tsx",
    "JournalGroupCard.tsx", "InvoiceCard.tsx", "ProfileFactCard.tsx", "CheckInQuestionCard.tsx",
    "CompactObjectCard.tsx", "FullObjectCard.tsx", "ObjectCardButtons.tsx", "ObjectCardIcons.tsx",
  ];
  for (const filename of expected) assert.equal(fs.existsSync(path.join(cardsRoot, filename)), true, filename);
});

test("the network dispatches to domain cards instead of rendering its own object card", () => {
  const network = fs.readFileSync(path.join(root, "web/src/components/ObjectNetworkButton.tsx"), "utf8");
  const dispatcher = fs.readFileSync(path.join(cardsRoot, "ObjectCard.tsx"), "utf8");
  const editable = fs.readFileSync(path.join(root, "web/src/components/EditableItems.tsx"), "utf8");
  const app = fs.readFileSync(path.join(root, "web/src/App.tsx"), "utf8");
  assert.match(network, /<ObjectCard/);
  assert.doesNotMatch(network, /<FirstClassObjectCard/);
  assert.match(dispatcher, /case "todos\.personal_task": return <TodoCard/);
  assert.match(dispatcher, /case "contacts\.contact": return <ContactCard/);
  for (const domainType of [
    "todos.todo_group", "payments.invoice", "journal.group", "journal.tracker", "journal.entry",
    "calendar.event", "calendar.routine", "files.file", "profile.fact", "catch_up.question",
    "video.script", "video.content_group", "video.content_item",
  ]) assert.match(dispatcher, new RegExp(`case "${domainType.replaceAll(".", "\\.")}": return <`));
  assert.match(editable, /<TodoCard/);
  assert.match(editable, /<CalendarEventCard/);
  assert.match(editable, /<CalendarRoutineCard/);
  assert.match(app, /<ContactCard/);
  assert.match(app, /<FileCard/);
  assert.match(app, /<InvoiceCard/);
});

test("compact cards have one identity and exactly the shared expand, network, and selection controls", () => {
  const compact = fs.readFileSync(path.join(cardsRoot, "CompactObjectCard.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web/src/components/ObjectSelectionControls.tsx"), "utf8");
  const buttons = fs.readFileSync(path.join(cardsRoot, "ObjectCardButtons.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  assert.match(compact, /object\.label/);
  assert.match(compact, /object\.display/);
  assert.match(compact, /className="compact-object-expand"/);
  assert.match(compact, /\{controls\}/);
  assert.doesNotMatch(compact, /object\.body|object\.attributes|object\.badges|actions\.map/);
  assert.match(references, /<ObjectNetworkButton identity=\{identity\}/);
  assert.match(references, /<ObjectCardSelectionCheckbox/);
  assert.match(buttons, /className="object-selection-checkbox"/);
  assert.match(buttons, /className="object-network-button"/);
  assert.match(styles, /\.compact-object-card \{/);
  assert.match(styles, /\.compact-object-controls/);
  assert.doesNotMatch(styles, /network-search-results \.first-class-object-card|network-object-card/);
});

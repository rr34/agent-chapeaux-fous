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
    "ObjectCardSequence.tsx",
  ];
  for (const filename of expected) assert.equal(fs.existsSync(path.join(cardsRoot, filename)), true, filename);
});

test("the network dispatches to domain cards instead of rendering its own object card", () => {
  const network = fs.readFileSync(path.join(root, "web/src/components/ObjectNetworkButton.tsx"), "utf8");
  const dispatcher = fs.readFileSync(path.join(cardsRoot, "ObjectCard.tsx"), "utf8");
  const editable = fs.readFileSync(path.join(root, "web/src/components/EditableItems.tsx"), "utf8");
  const app = fs.readFileSync(path.join(root, "web/src/App.tsx"), "utf8");
  assert.match(network, /<ObjectCard/);
  assert.equal(network.match(/mode="compact"/gu)?.length, 2);
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
  const simple = fs.readFileSync(path.join(cardsRoot, "SimpleObjectCard.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web/src/components/ObjectSelectionControls.tsx"), "utf8");
  const buttons = fs.readFileSync(path.join(cardsRoot, "ObjectCardButtons.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  assert.match(compact, /object\.label/);
  assert.match(compact, /object\.display/);
  assert.match(compact, /className="compact-object-expand"/);
  assert.match(compact, /useState\(defaultExpanded\)/);
  assert.match(simple, /defaultExpanded=\{defaultExpanded\}/);
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

test("calendar event cards keep notes and event details behind the shared expansion", () => {
  const calendar = fs.readFileSync(path.join(cardsRoot, "CalendarEventCard.tsx"), "utf8");
  const compact = fs.readFileSync(path.join(cardsRoot, "CompactObjectCard.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  assert.match(compact, /compactDetails && <div className="compact-object-details">/);
  assert.match(calendar, /Needs planning/);
  assert.match(calendar, /linked.*to-do/);
  assert.match(calendar, /<h4>Contacts<\/h4>/);
  assert.match(calendar, /<h4>Planning prompt<\/h4>/);
  assert.match(calendar, /event\?: CalendarEvent/);
  assert.match(calendar, /calendarEventTiming\(event, props\.timeZone\)/);
  assert.match(calendar, /topEdge=\{timing \? <time className="calendar-event-time calendar-event-time--start"/);
  assert.match(calendar, /bottomEdge=\{timing\?\.end \? <time className="calendar-event-time calendar-event-time--end"/);
  assert.match(compact, /compact-object-top-edge/);
  assert.match(styles, /\.calendar-event-card \{[^}]*border-color: #8f9788;/s);
  assert.match(styles, /\.calendar-event-card \.first-class-object-label,[\s\S]*\.calendar-event-card \.compact-object-identity > span:first-child \{ display: none; \}/);
  assert.match(styles, /\.calendar-event-card \.first-class-object-content \{[^}]*grid-template-columns: minmax\(9rem, \.8fr\) minmax\(0, 1\.4fr\);/s);
  assert.match(styles, /\.calendar-event-card \.first-class-object-body \{[^}]*grid-column: 2;[^}]*margin: 0;/s);
  assert.match(styles, /\.calendar-event-card \.first-class-object-body \{[^}]*-webkit-line-clamp: 2;[^}]*font-size: 11px;/s);
});

test("sequenced to-dos and library items own one prominent marker in full and compact cards", () => {
  const todo = fs.readFileSync(path.join(cardsRoot, "TodoCard.tsx"), "utf8");
  const library = fs.readFileSync(path.join(cardsRoot, "LibraryItemCard.tsx"), "utf8");
  const sequence = fs.readFileSync(path.join(cardsRoot, "ObjectCardSequence.tsx"), "utf8");
  const simple = fs.readFileSync(path.join(cardsRoot, "SimpleObjectCard.tsx"), "utf8");
  const compact = fs.readFileSync(path.join(cardsRoot, "CompactObjectCard.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");

  assert.match(todo, /prominentObjectSequence\(normalizedObject\)/);
  assert.match(library, /prominentObjectSequence\(props\.object\)/);
  assert.match(sequence, /attributes: object\.attributes\?\.filter\(\(\{ label \}\) => label !== "Sequence"\)/);
  assert.match(sequence, /className="object-card-sequence"/);
  assert.match(sequence, />\{sequence\}<\/span>/);
  assert.doesNotMatch(sequence, />#\{sequence\}<\/span>/);
  assert.match(simple, /<CompactObjectCard[\s\S]*leading=\{leading\}/);
  assert.match(compact, /leading && <div className="compact-object-leading">\{leading\}<\/div>/);
  assert.match(styles, /\.object-card-sequence \{[^}]*min-width: 54px;[^}]*font: 750 22px\/1/s);
  assert.match(styles, /\.compact-object-card \.object-card-sequence \{[^}]*min-width: 44px;/s);
});

test("interactive views do not retain pre-reusable or view-scoped card styling", () => {
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  assert.doesNotMatch(styles, /\.todo-row|\.todo-sequence|\.library-row|\.library-sequence/);
  const reusableRoots = [
    "first-class-object-", "compact-object-", "contact-card", "todo-card", "todo-group-card",
    "calendar-event-card", "calendar-routine-card", "file-card", "library-item-card",
    "library-group-card", "video-script-card", "journal-tracker-card", "journal-entry-card",
    "journal-group-card", "invoice-card", "profile-fact-card", "check-in-question-card",
  ];
  for (const line of styles.split("\n")) {
    if (!/\.(?:first-class-object-|compact-object-)/.test(line)) continue;
    for (const selector of line.split("{")[0].split(",")) {
      const trimmed = selector.trim();
      if (!/\.(?:first-class-object-|compact-object-)/.test(trimmed)) continue;
      assert.equal(
        reusableRoots.some((rootClass) => trimmed.startsWith(`.${rootClass}`)),
        true,
        `shared card styling must not be scoped by a view: ${trimmed}`,
      );
    }
  }
});

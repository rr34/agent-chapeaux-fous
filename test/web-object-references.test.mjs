import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the React UI can reference every displayed first-class object in Agent", () => {
  const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
  const dailyPaper = fs.readFileSync(path.join(root, "web", "src", "components", "DailyPaper.tsx"), "utf8");
  const routines = fs.readFileSync(path.join(root, "web", "src", "components", "RoutineCalendar.tsx"), "utf8");
  const editableItems = fs.readFileSync(path.join(root, "web", "src", "components", "EditableItems.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web", "src", "components", "AgentReferenceButton.tsx"), "utf8");

  assert.match(references, /M20 19c0-4\.4-3\.6-8-8-8H4/);
  assert.match(references, /aria-label=\{label\}/);
  assert.match(references, /ref: stableReference\("calendar-events", numericEventId\)/);
  assert.match(references, /ref: stableReference\("todos", id\)/);
  assert.match(references, /ref: stableReference\("contacts", contact\.id\)/);
  assert.match(references, /content_id/);
  assert.match(references, /video_script_id/);
  assert.match(references, /file_id/);
  assert.match(references, /journal_entry_id/);
  assert.match(references, /calendar_routine_id/);

  assert.match(app, /identity=\{exchangeIdentity\(request\)\}/);
  assert.match(editableItems, /identity=\{todoIdentity\(todo\)\}/);
  assert.match(app, /identity=\{contactIdentity\(contact\)\}/);
  assert.match(app, /identity=\{genericEntityIdentity\(kind, entity\)\}/);
  assert.match(app, /identity=\{journalTrackerIdentity\(tracker\)\}/);
  assert.match(app, /identity=\{journalEntryIdentity\(entry\)\}/);
  assert.match(editableItems, /identity=\{calendarEventIdentity\(event, timeZone\)\}/);
  assert.match(editableItems, /identity=\{todoIdentity\(todo\)\}/);
  assert.match(editableItems, /onReference && Number\.isSafeInteger\(eventId\) && eventId > 0/);
  assert.match(editableItems, /onReference && <AgentReferenceButton identity=\{todoIdentity\(todo\)\}/);
  assert.match(editableItems, /identity=\{calendarRoutineIdentity\(routine\)\}/);
});

test("React reference arrows add native inline objects while retaining exact source metadata", () => {
  const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web", "src", "components", "AgentReferenceButton.tsx"), "utf8");
  assert.doesNotMatch(app, /"In reference to:\\n" \+ identity/);
  assert.match(app, /setAgentObjectSelections\(\(current\) => \[\.\.\.current, identity\]\)/);
  assert.match(app, /identity\.mention \+ \(current/);
  assert.match(app, /const referencedRequestIds = \[\.\.\.new Set\(selections\.flatMap/);
  assert.match(app, /referencedRequestId \? \[\] : \[selection\]/);
  assert.match(references, /mention: `@\$\{title\}`/);
  assert.match(references, /type: "calendar\.event", source: "native:calendar"/);
  assert.match(references, /collection: "calendar-events", label: "Calendar event"/);
  assert.match(references, /const detail = \[\s*`Calendar event:/);
  assert.match(references, /Reference code:/);
  assert.match(references, /referencedRequestId: request\.requestId/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the React UI can select every displayed first-class object for Agent", () => {
  const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
  const dailyPaper = fs.readFileSync(path.join(root, "web", "src", "components", "DailyPaper.tsx"), "utf8");
  const routines = fs.readFileSync(path.join(root, "web", "src", "components", "RoutineCalendar.tsx"), "utf8");
  const editableItems = fs.readFileSync(path.join(root, "web", "src", "components", "EditableItems.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web", "src", "components", "ObjectSelectionControls.tsx"), "utf8");
  const buttons = fs.readFileSync(path.join(root, "web", "src", "components", "object-cards", "ObjectCardButtons.tsx"), "utf8");

  assert.match(buttons, /type="checkbox"/);
  assert.match(buttons, /aria-label=\{label\}/);
  assert.match(references, /ref: stableReference\("calendar-events", numericEventId\)/);
  assert.match(references, /ref: stableReference\("todos", id\)/);
  assert.match(references, /ref: stableReference\("contacts", contact\.id\)/);
  assert.match(references, /type: "payments\.invoice", source: "native:payments"/);
  assert.match(references, /payment_invoice_id: id, ref: stableReference\("payment-invoices", id\)/);
  assert.match(references, /content_id/);
  assert.match(references, /video_script_id/);
  assert.match(references, /file_id/);
  assert.match(references, /journal_entry_id/);
  assert.match(references, /calendar_routine_id/);

  assert.match(app, /identity=\{exchangeIdentity\(request\)\}/);
  assert.match(editableItems, /identity=\{todoIdentity\(todo\)\}/);
  assert.match(app, /identity=\{contactIdentity\(contact\)\}/);
  assert.match(app, /identity=\{invoiceIdentity\(invoice\)\}/);
  assert.match(app, /identity=\{genericEntityIdentity\(kind, entity\)\}/);
  assert.match(app, /identity=\{journalTrackerIdentity\(tracker\)\}/);
  assert.match(app, /identity=\{journalEntryIdentity\(entry\)\}/);
  assert.match(editableItems, /identity=\{calendarEventIdentity\(event, timeZone\)\}/);
  assert.match(editableItems, /identity=\{todoIdentity\(todo\)\}/);
  assert.match(editableItems, /Number\.isSafeInteger\(eventId\) && eventId > 0 \? <ObjectSelectionControls/);
  assert.match(editableItems, /controls=\{<>\s*<ObjectSelectionControls identity=\{todoIdentity\(todo\)\}/);
  assert.match(editableItems, /identity=\{calendarRoutineIdentity\(routine\)\}/);
});

test("card checkboxes stage exact native object bindings without modifying the instruction text", () => {
  const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web", "src", "components", "ObjectSelectionControls.tsx"), "utf8");
  assert.doesNotMatch(app, /"In reference to:\\n" \+ identity/);
  assert.doesNotMatch(app, /insertObjectMentions/);
  assert.match(app, /selectionOrigin: "card"/);
  assert.match(app, /composer-selection-summary/);
  assert.match(app, /selected for this request/);
  assert.match(app, /const referencedRequestIds = \[\.\.\.new Set\(selections\.flatMap/);
  assert.match(app, /referencedRequestId \? \[\] : \[selection\]/);
  assert.match(references, /mention: descriptiveObjectMention/);
  assert.match(references, /type: "calendar\.event", source: "native:calendar"/);
  assert.match(references, /collection: "calendar-events", label: "Calendar event"/);
  assert.match(references, /const detail = \[\s*`Calendar event:/);
  assert.match(references, /Reference code:/);
  assert.match(references, /referencedRequestId: request\.requestId/);
});

test("object selection stays in the current section and shares one workspace selection state", () => {
  const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
  const handler = app.slice(app.indexOf("const toggleObjectSelection"), app.indexOf("const showTrace"));
  assert.doesNotMatch(handler, /go\("agent"\)/);
  assert.match(app, /<ObjectSelectionProvider selections=\{agentObjectSelections\}/);
  assert.match(handler, /current\.filter\(\(\{ ref \}\) => ref !== identity\.ref\)/);
  assert.match(handler, /maximumObjectReferences/);
});

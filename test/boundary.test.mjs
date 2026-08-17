import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set(["node_modules", ".git", "data", "media", ".venv"]);
const excludedFiles = new Set([".env"]);
const excludedRelativeFiles = new Set(["db/schema-semantics.json", "text.json"]);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excludedFiles.has(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return excludedDirectories.has(entry.name) ? [] : files(filename);
    }
    // Runtime state can contain sockets or symlinks to directories. The
    // boundary assertion is about repository source files, so never follow or
    // read non-regular entries.
    return entry.isFile() ? [filename] : [];
  });
}

test("the standalone tree contains no previous runtime-host references", () => {
  const forbidden = ["open", "claw"].join("");
  const matches = [];
  for (const filename of files(root)) {
    if (excludedRelativeFiles.has(path.relative(root, filename))) continue;
    const content = fs.readFileSync(filename);
    if (content.includes(0)) continue;
    if (content.toString("utf8").toLowerCase().includes(forbidden)) matches.push(path.relative(root, filename));
  }
  assert.deepEqual(matches, []);
});

test("base instructions are integration-neutral and route durable profile changes", () => {
  const instructions = fs.readFileSync(path.join(root, "config", "system-prompt.md"), "utf8");
  assert.doesNotMatch(instructions, /TLOM/i);
  assert.match(instructions, /personal to-dos/);
  assert.match(instructions, /call history_range/);
  assert.match(instructions, /date and topic are filtered in\s+one lookup/);
  assert.match(instructions, /stored SQLite field names/);
  assert.match(instructions, /schema-semantic compiler projection/);
  assert.match(instructions, /previous Monday-through-Monday interval/);
  assert.match(instructions, /never ask the user to\s+write RRULE syntax/);
  assert.match(instructions, /personal-log tools/);
  assert.match(instructions, /complete natural-language log\s+content/);
  assert.match(instructions, /log_import in bounded\s+batches/);
  assert.match(instructions, /use contact_import in bounded batches/);
  assert.match(instructions, /contact_duplicate_list/);
  assert.match(instructions, /contact_merge/);
  assert.match(instructions, /profile_fact_set/);
  assert.match(instructions, /profile_fact_delete/);
  assert.match(instructions, /calendar_event_list/);
  assert.match(instructions, /calendar_event_recurrence_set/);
  assert.match(instructions, /email_cleanup_receipt_list/);
  assert.match(instructions, /do not replace that receipt with unrelated\s+mail already present in Trash/);
  assert.match(instructions, /native JMAP tools as the live authority/);
  assert.match(instructions, /Call email_send only when\s+the user explicitly asks to send/);
  assert.match(instructions, /open-ended\s+collection/);
  assert.match(instructions, /Relevant profile types/);
  assert.doesNotMatch(instructions, /no active preferred_name fact exists/);
});

test("the todo editor builds recurrence without exposing an RRULE input", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /id="todo-repeat-enabled"/);
  assert.match(document, /id="todo-repeat-frequency"/);
  assert.match(document, /id="todo-repeat-weekdays"/);
  assert.match(document, /id="todo-repeat-fields" class="recurrence-fields" hidden/);
  assert.doesNotMatch(document, /Routine RRULE|todo-recurrence-rule/);
});

test("the calendar event editor exposes recurrence only after its repeat checkbox", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(document, /id="event-repeat-enabled"/);
  assert.match(document, /id="event-repeat-fields" class="recurrence-fields" hidden/);
  assert.match(document, /id="event-repeat-weekdays"/);
  assert.ok(document.indexOf('id="event-repeat-enabled"') < document.indexOf('id="event-repeat-fields"'));
  assert.match(application, /recurrenceRule: buildEventRecurrenceRule\(\)/);
  assert.match(application, /loadEventRecurrenceEditor\(calendarEvent\?\.recurrenceRule \?\? null\)/);
});

test("saved calendar events can create reviewable Fastmail invitation drafts without sending", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="event-invite-draft"[^>]+>Create invite draft</);
  assert.match(document, /id="event-invite-dialog"/);
  assert.match(document, /creates a draft only; it does not send email or add anything to Fastmail Calendar/i);
  assert.match(application, /async function openEventInviteDraft/);
  assert.match(application, /async function createEventInviteDraft/);
  assert.match(application, /contactIds: \[\.\.\.eventInviteSelectedContactIds\]/);
  assert.match(server, /\/invite-draft/);
  assert.match(server, /createCalendarInviteDraft/);
  assert.match(server, /registry\.execute\("email_draft_create"/);
  assert.doesNotMatch(server, /invite-draft[\s\S]{0,1000}registry\.execute\("email_send"/);
});

test("each displayed calendar event has a phone-friendly copy-details action", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(application, /function calendarEventCopyText/);
  assert.match(application, /node\("button", "secondary compact agenda-event-copy", "Copy details"\)/);
  assert.match(application, /copyText\(calendarEventCopyText\(calendarEvent\), event\.currentTarget\)/);
  assert.match(application, /`Time zone: \$\{timeZone\}`/);
  assert.match(application, /`Repeats: \$\{describeTodoRecurrence\(calendarEvent\.recurrenceRule\)\}`/);
});

test("calendar controls use simple visibility states and 24-hour datetime locales", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const status = /<select id="event-status">([\s\S]*?)<\/select>/.exec(document)?.[1] ?? "";
  assert.match(status, /<option value="active">Active<\/option><option value="archived">Archived<\/option>/);
  assert.doesNotMatch(status, />Confirmed<|>Tentative<|>Completed<|>Cancelled</);
  assert.equal((document.match(/type="datetime-local" lang="en-GB"/g) ?? []).length, 5);
});

test("the web client provides a provider-neutral OAuth integrations manager", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /id="integrations-button"/);
  assert.match(document, /id="integrations-dialog"/);
  assert.match(application, /\.filter\(\(\[, integration\]\) => integration\.oauth\)/);
  assert.doesNotMatch(application, /\.find\(\(\[, integration\]\) => integration\.oauth\)/);
  assert.match(application, /for \(const \[name, integration\] of oauthEntries\)/);
  assert.match(application, /oauth\/disconnect/);
});

test("the standalone client restores calendar, grouped to-do, and personal log surfaces", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /data-view="calendar"/);
  assert.match(document, /data-view="todos"/);
  assert.match(document, /data-view="logs"/);
  assert.match(document, /<span>Mon<\/span><span>Tue<\/span><span>Wed<\/span><span>Thu<\/span><span>Fri<\/span><span>Sat<\/span><span>Sun<\/span>/);
  assert.ok(document.indexOf('class="agenda-panel') < document.indexOf('class="month-panel'));
  assert.match(application, /refreshCalendar/);
  assert.match(application, /refreshTodos/);
  assert.match(application, /refreshLogs/);
  assert.match(application, /todo-group-heading/);
  assert.match(application, /const headingTitle = node\("div", "todo-group-heading-title"\)/);
  assert.match(application, /headingTitle\.append\(rename, archive\)/);
  assert.match(application, /headingTitle\.append\(top, up, down, bottom\)/);
  assert.match(application, /node\("button", "secondary compact", "Add task"\)/);
  assert.match(application, /addTask\.addEventListener\("click", \(\) => openTodoEditor\(null, groupId\)\)/);
  assert.match(application, /todo\?\.groupId \?\? groupId \?\?/);
  assert.match(application, /for \(const \[groupId, group\] of groupedTodos\)/);
  assert.match(document, /id="todo-new-group"/);
  assert.match(application, /populateTodoGroupEditor\(group\.id\)/);
  assert.match(application, /actions\.append\(top, up, down, bottom, edit\)/);
  assert.match(application, /\/api\/todo-groups\/\$\{todo\.groupId\}\/reorder/);
  assert.match(application, /Archive group/);
  assert.match(application, /archiveTodoGroup/);
  assert.match(document, /id="calendar-schedule-mode"/);
  assert.match(application, /beginCalendarScheduling/);
  assert.match(application, /scheduleTodoOnDate/);
  assert.match(application, /todo\.scheduledAtUtc \? "Reschedule" : "Schedule"/);
  assert.match(document, /id="todo-all-day"/);
  assert.match(application, /isAllDay: true/);
  assert.match(application, /scheduled for that whole day/);
  assert.match(server, /\/api\/calendar-events/);
  assert.match(server, /\/api\/todo-groups/);
  assert.match(server, /todoGroupReorderMatch/);
  assert.match(server, /todoGroupArchiveMatch/);
  assert.match(server, /\/api\/todos/);
  assert.match(server, /\/api\/log-trackers/);
  assert.match(server, /\/api\/log-entries/);
});

test("the standalone client provides a native contacts address book", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /data-view="contacts"/);
  assert.match(document, /id="contacts-view"/);
  assert.match(document, /id="contact-search"/);
  assert.match(document, /id="contact-tag-filter"/);
  assert.match(document, /id="review-contact-duplicates"/);
  assert.match(document, /id="contact-dialog"/);
  assert.match(document, /id="contact-tags"/);
  assert.match(document, /id="contact-method-list"/);
  assert.match(document, /id="contact-duplicates-dialog"/);
  assert.match(application, /async function refreshContacts/);
  assert.match(application, /function renderContacts/);
  assert.match(application, /function duplicateContactGroups/);
  assert.match(application, /\/api\/contacts\/duplicates\?limit=200/);
  assert.match(application, /function renderContactDuplicateReview/);
  assert.match(application, /node\("button", "contact-method-value contact-method-copy", method\.value\)/);
  assert.match(application, /copyText\(method\.value, event\.currentTarget\)/);
  assert.match(application, /function addContactMethodRow/);
  assert.match(application, /function saveContact/);
  assert.match(application, /\/api\/contacts\?scope=all/);
  assert.match(server, /organizer\.listContacts/);
  assert.match(server, /organizer\.createContact/);
  assert.match(server, /organizer\.updateContact/);
  assert.match(server, /organizer\.mergeContacts/);
  assert.match(server, /organizer\.listContactDuplicates/);
  assert.match(server, /registerContactTools/);
});

test("the request composer keeps Shift+Enter for newlines and submits other Enter shortcuts", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(application, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.doesNotMatch(application, /event\.key !== "Enter" \|\| event\.ctrlKey/);
});

test("the request composer accepts one bounded CSV, vCard, or text attachment", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="request-file"[^>]+accept="\.csv,\.vcf,\.txt,text\/csv,text\/vcard,text\/x-vcard,text\/plain"/);
  assert.match(application, /\/api\/request-files\?filename=/);
  assert.match(application, /lowerName\.endsWith\("\.vcf"\) \? "text\/vcard"/);
  assert.match(application, /JSON\.stringify\(\{ text, primaryFileId \}\)/);
  assert.match(server, /receiveTextAttachment/);
  assert.match(server, /url\.pathname === "\/api\/request-files"/);
  assert.match(server, /ledger\.createRequest\(\{ text, channel: "web", primaryFileId \}\)/);
});

test("the request feed can start a new native model conversation without clearing application history", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="new-conversation"/);
  assert.match(document, /class="conversation-start"[^>]+hidden>New conversation/);
  assert.match(application, /api\("\/api\/conversation\/reset", \{ method: "POST" \}\)/);
  assert.match(application, /request\.conversationStarted/);
  assert.match(server, /ledger\.resetModelConversation/);
  assert.match(server, /ledger\.unfinishedRequestCount/);
});

test("clicking a displayed request ID copies the complete request ID", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /<button class="request-number" type="button"><\/button>/);
  assert.match(application, /querySelector\("\.request-number"\)\.addEventListener\("click"/);
  assert.match(application, /copyText\(request\.requestId, event\.currentTarget\)/);
  assert.match(application, /requestNumber\.setAttribute\("aria-label", `Copy request ID \$\{request\.requestId\}`\)/);
});

test("clicking a to-do item's text copies the complete task text", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(application, /node\("button", "todo-text", todo\.text\)/);
  assert.match(application, /text\.setAttribute\("aria-label", `Copy task text: \$\{todo\.text\}`\)/);
  assert.match(application, /text\.addEventListener\("click", \(event\) => void copyText\(todo\.text, event\.currentTarget\)\)/);
});

test("hard-coded UI datetimes use the TLOM 24-hour display convention", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(application, /function formatDisplayDate/);
  assert.match(application, /function formatDisplayTime/);
  assert.match(application, /weekday: "short", day: "2-digit", month: "short", year: "numeric"/);
  assert.match(application, /hour: "2-digit", minute: "2-digit", hourCycle: "h23"/);
  assert.match(application, /`\$\{dateLabel\} at \$\{formatDisplayTime\(date, \{ timeZone, fallback \}\)\}`/);
  assert.match(application, /formatDisplayDate\(value, \{ includeTime: false, timeZone \}\)/);
  assert.match(application, /return formatDisplayDate\(value\)/);
});

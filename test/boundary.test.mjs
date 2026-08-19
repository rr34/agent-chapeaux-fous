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

test("base instructions stay universal while capability fragments retain domain behavior", () => {
  const baseInstructions = fs.readFileSync(path.join(root, "config", "system-prompt.md"), "utf8");
  const capabilityRoot = path.join(root, "config", "instructions");
  const instructions = fs.readdirSync(capabilityRoot)
    .sort()
    .map((filename) => fs.readFileSync(path.join(capabilityRoot, filename), "utf8"))
    .join("\n");
  assert.doesNotMatch(baseInstructions, /TLOM/i);
  assert.doesNotMatch(baseInstructions, /personal to-dos|native JMAP|contact_dedupe_clear/);
  assert.ok(baseInstructions.length < 2500, `universal prompt grew to ${baseInstructions.length} characters`);
  assert.match(baseInstructions, /inspect its metadata, visible structure,\s+headers, and relevant records/);
  assert.match(baseInstructions, /never ask the user to\s+identify information plainly visible in the attachment/);
  assert.match(instructions, /personal to-dos/);
  assert.match(instructions, /call\s+`history_range`/);
  assert.match(instructions, /date and\s+topic are filtered in one lookup/);
  assert.match(instructions, /stored SQLite field names/);
  assert.match(instructions, /schema-semantic compiler projection/);
  assert.match(instructions, /previous Monday-through-Monday interval/);
  assert.match(instructions, /never ask the user to\s+write RRULE syntax/);
  assert.match(instructions, /personal-log tools/);
  assert.match(instructions, /complete natural-language log\s+content/);
  assert.match(instructions, /use `log_import` in bounded batches/);
  assert.match(instructions, /contact_file_import/);
  assert.match(instructions, /full verified file in one\s+call/);
  assert.match(instructions, /Use `contact_import` in bounded batches\s+only/);
  assert.match(instructions, /contact_duplicate_list/);
  assert.match(instructions, /contact_dedupe_clear/);
  assert.match(instructions, /max_groups=500/);
  assert.match(instructions, /do not start by manually merging an arbitrary small batch/);
  assert.match(instructions, /contact_merge/);
  assert.match(instructions, /contact_merge_batch/);
  assert.match(instructions, /batch is atomic/);
  assert.match(instructions, /profile_fact_set/);
  assert.match(instructions, /profile_fact_delete/);
  assert.match(instructions, /calendar_event_list/);
  assert.match(instructions, /calendar_event_search/);
  assert.match(instructions, /calendar_event_recurrence_set/);
  assert.match(instructions, /email_cleanup_receipt_list/);
  assert.match(instructions, /do\s+not replace that receipt with unrelated mail already present in Trash/);
  assert.match(instructions, /native JMAP tools as the live authority/);
  assert.match(instructions, /Call `email_send` only when the user explicitly\s+asks to send/);
  assert.match(instructions, /open-ended\s+collection/);
  assert.match(instructions, /Use `web_page_read`/);
  assert.match(instructions, /page reading, not web search/);
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
  assert.doesNotMatch(application, /`Time zone: \$\{timeZone\}`/);
  assert.match(application, /`Repeats: \$\{describeTodoRecurrence\(calendarEvent\.recurrenceRule\)\}`/);
});

test("the calendar UI searches stored event details and can include archived records", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="calendar-search"[^>]+type="search"/);
  assert.match(document, /id="calendar-search-include-archived"[^>]+type="checkbox"/);
  assert.match(document, /Recurring series appear once/);
  assert.match(application, /async function searchCalendarEvents/);
  assert.match(application, /\/api\/calendar-events\/search/);
  assert.match(application, /renderCalendarSearchResults/);
  assert.match(server, /url\.pathname === "\/api\/calendar-events\/search"/);
});

test("calendar controls use simple visibility states and explicit 24-hour event times", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  const status = /<select id="event-status">([\s\S]*?)<\/select>/.exec(document)?.[1] ?? "";
  assert.match(status, /<option value="active">Active<\/option><option value="archived">Archived<\/option>/);
  assert.doesNotMatch(status, />Confirmed<|>Tentative<|>Completed<|>Cancelled</);
  assert.equal((document.match(/type="datetime-local" lang="en-GB"/g) ?? []).length, 4);
  assert.match(document, /id="event-start-time"[^>]+placeholder="HH:MM"[^>]+pattern="\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d"/);
  assert.match(document, /id="event-end-time"[^>]+placeholder="HH:MM"[^>]+pattern="\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d"/);
  assert.match(document, /id="event-duration"[^>]+aria-live="polite"/);
  assert.match(application, /if \(calendarEvent\.isAllDay\) return "";/);
  assert.match(application, /shiftLocalDateTime\(elements\.eventStart\.value, elements\.eventStartTime\.value, 60\)/);
  assert.match(application, /`Duration: \$\{formatDurationMinutes\(minutes\)\}`/);
  assert.match(server, /\["\/event-date-time\.js", \["event-date-time\.js", "text\/javascript; charset=utf-8"\]\]/);
  assert.match(application, /elements\.todoScheduled\.step = allDay \? "1" : "60";/);
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

test("the standalone client restores calendar, grouped to-do, grouped content, and personal log surfaces", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /data-view="calendar"/);
  assert.match(document, /data-view="todos"/);
  assert.match(document, /id="agent-view-button"[^>]*>Agent<\/button>/);
  assert.match(document, /id="view-selector"/);
  assert.doesNotMatch(document, /<option[^>]+value="agent"/);
  assert.match(document, /data-view="content"/);
  assert.match(document, /data-view="logs"/);
  assert.match(document, /id="content-view"/);
  assert.match(document, /id="content-dialog"/);
  assert.match(document, /id="content-delete"[^>]+hidden>Delete content<\/button>/);
  assert.match(document, /id="content-title"/);
  assert.match(document, /id="content-description"/);
  assert.match(document, /id="content-transcript"/);
  assert.match(document, /<span>Mon<\/span><span>Tue<\/span><span>Wed<\/span><span>Thu<\/span><span>Fri<\/span><span>Sat<\/span><span>Sun<\/span>/);
  assert.match(document, /aria-label="Previous two weeks"/);
  assert.match(document, /aria-label="Next two weeks"/);
  assert.ok(document.indexOf('class="calendar-range-panel') < document.indexOf('class="agenda-panel'));
  assert.match(application, /function twoWeekCalendarRange/);
  assert.match(application, /const gridEnd = addDays\(gridStart, 14\)/);
  assert.match(application, /calendarRangeStart = addDays\(calendarRangeStart, -14\)/);
  assert.match(application, /calendarRangeStart = addDays\(calendarRangeStart, 14\)/);
  assert.match(application, /refreshCalendar/);
  assert.match(application, /refreshTodos/);
  assert.match(application, /refreshContent/);
  assert.match(application, /agentViewButton\.addEventListener\("click", \(\) => switchView\("agent"\)\)/);
  assert.match(application, /renderContent/);
  assert.match(application, /elements\.contentDelete\.hidden = !item/);
  assert.match(application, /elements\.contentDelete\.addEventListener\("click"/);
  assert.doesNotMatch(application, /node\("button", "danger compact", "Delete"\)/);
  assert.match(application, /safeContentUrl/);
  assert.match(application, /refreshLogs/);
  assert.match(application, /todo-group-heading/);
  assert.match(application, /todo-group-sequence-marker/);
  assert.match(application, /todo-sequence-display/);
  assert.match(application, /content-sequence-display/);
  assert.doesNotMatch(application, /metadata\.append\(node\("span", "todo-pill", `#\$\{item\.sequence\}`\)\)/);
  assert.match(application, /\/api\/todo-groups\/\$\{groupId\}\/sequence/);
  assert.match(application, /Assign next #/);
  assert.match(application, /\/api\/todos\/\$\{todo\.id\}\/assign-next-sequence/);
  assert.match(application, /const headingTitle = node\("div", "todo-group-heading-title"\)/);
  assert.match(application, /headingTitle\.append\(rename, archive\)/);
  assert.match(application, /headingTitle\.append\(top, up, down, bottom\)/);
  assert.match(application, /node\("button", "secondary compact", "Add task"\)/);
  assert.match(application, /addTask\.addEventListener\("click", \(\) => openTodoEditor\(null, groupId\)\)/);
  assert.match(application, /todo\?\.groupId \?\? groupId \?\?/);
  assert.match(application, /for \(const \[groupId, group\] of groupedTodos\)/);
  assert.match(document, /id="todo-new-group"/);
  assert.match(document, /id="todo-contact-filter"/);
  assert.match(document, /id="todo-contact"/);
  assert.match(application, /populateTodoGroupEditor\(group\.id\)/);
  assert.match(application, /function populateTodoContactEditor/);
  assert.match(application, /relatedContactId: elements\.todoContact\.value/);
  assert.match(application, /todo\.relatedContactName/);
  assert.match(application, /actions\.append\(top, up, down, bottom, edit\)/);
  assert.match(application, /\/api\/todo-groups\/\$\{todo\.groupId\}\/reorder/);
  assert.match(application, /Archive group/);
  assert.match(application, /archiveTodoGroup/);
  assert.match(document, /id="calendar-schedule-mode"/);
  assert.match(application, /beginCalendarScheduling/);
  assert.match(application, /scheduleTodoOnDate/);
  assert.match(application, /cancelCalendarScheduling\(\{ render: false \}\);\s+switchView\("todos"\);/);
  assert.match(application, /todo\.scheduledAtUtc \? "Reschedule" : "Schedule"/);
  assert.match(document, /id="todo-clear-scheduled"[^>]+hidden>Clear date<\/button>/);
  assert.ok(document.indexOf('id="todo-scheduled"') < document.indexOf('id="todo-clear-scheduled"'));
  assert.match(application, /function clearTodoScheduledInEditor/);
  assert.match(application, /elements\.todoScheduled\.value = ""/);
  assert.match(application, /elements\.todoAllDay\.checked = false/);
  assert.match(application, /elements\.todoClearScheduled\.hidden = !elements\.todoId\.value/);
  assert.doesNotMatch(application, /node\("button", "secondary compact", "Clear date"\)/);
  assert.match(document, /id="todo-all-day"/);
  assert.match(application, /isAllDay: true/);
  assert.match(application, /scheduled for that whole day/);
  assert.match(server, /\/api\/calendar-events/);
  assert.match(server, /\/api\/todo-groups/);
  assert.match(server, /todoGroupReorderMatch/);
  assert.match(server, /todoGroupArchiveMatch/);
  assert.match(server, /\/api\/todos/);
  assert.match(server, /\/api\/content-items/);
  assert.match(server, /\/api\/content-groups/);
  assert.match(server, /reorderContentGroups/);
  assert.match(server, /archiveContentGroup/);
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
  assert.match(document, /id="contact-rename-tag"/);
  assert.match(document, /id="contact-bulk-actions"/);
  assert.match(document, /id="contact-add-tag"/);
  assert.match(document, /id="contact-delete-selected"/);
  assert.match(document, /id="review-contact-duplicates"/);
  assert.match(document, /id="contact-dialog"/);
  assert.doesNotMatch(document, /id="contact-given-name"/);
  assert.doesNotMatch(document, /id="contact-family-name"/);
  assert.match(document, /id="contact-tags"/);
  assert.match(document, /id="contact-method-list"/);
  assert.match(document, /id="contact-duplicates-dialog"/);
  assert.match(application, /async function refreshContacts/);
  assert.match(application, /function renderContacts/);
  assert.match(application, /function addTagToSelectedContacts/);
  assert.match(application, /function deleteSelectedContacts/);
  assert.match(application, /async function renameContactTag/);
  assert.doesNotMatch(application, /contactGivenName/);
  assert.doesNotMatch(application, /contactFamilyName/);
  assert.match(application, /node\("input", "contact-select-checkbox"\)/);
  assert.doesNotMatch(application, /contactInitials/);
  assert.match(application, /function duplicateContactGroups/);
  assert.match(application, /\/api\/contacts\/duplicates\?limit=200/);
  assert.match(application, /function renderContactDuplicateReview/);
  assert.match(application, /node\("button", "contact-method-value contact-method-copy", method\.value\)/);
  assert.match(application, /copyText\(method\.value, event\.currentTarget\)/);
  assert.match(application, /function addContactMethodRow/);
  assert.match(application, /function selectPrimaryContactMethod/);
  assert.match(application, /primary\.addEventListener\("change", \(\) => selectPrimaryContactMethod\(row\)\)/);
  assert.match(application, /function saveContact/);
  assert.match(application, /\/api\/contacts\?scope=all/);
  assert.match(server, /organizer\.listContacts/);
  assert.match(server, /organizer\.createContact/);
  assert.match(server, /organizer\.updateContact/);
  assert.match(server, /organizer\.bulkContacts/);
  assert.match(server, /organizer\.renameContactTag/);
  assert.match(server, /organizer\.mergeContacts/);
  assert.match(server, /organizer\.listContactDuplicates/);
  assert.match(server, /registerContactTools/);
});

test("the request composer keeps Shift+Enter for newlines and submits other Enter shortcuts", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(application, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.doesNotMatch(application, /event\.key !== "Enter" \|\| event\.ctrlKey/);
});

test("new typed and voice requests speak by default with a persistent silent preference", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /id="respond-silently" type="checkbox"/);
  assert.doesNotMatch(document, /id="respond-silently"[^>]+checked/);
  assert.match(document, /<span>Respond silently<\/span>/);
  assert.match(application, /prepareSpeechOutput\(respondSilently\)/);
  assert.match(application, /expectSpokenResponse\(created\.requestId, respondSilently\)/);
  assert.match(application, /expectSpokenResponse\(created\.requestId, recordingRespondSilently\)/);
  assert.match(application, /pendingSpokenRequestIds\.has\(request\.requestId\)/);
  assert.match(application, /speakResponse\(request\.response\)/);
  assert.match(application, /responseSilenceStorageKey = "agent-slayer-respond-silently"/);
  assert.match(application, /elements\.respondSilently\.checked = loadResponseSilencePreference\(\)/);
  assert.match(application, /elements\.respondSilently\.addEventListener\("change", saveResponseSilencePreference\)/);
  assert.doesNotMatch(application, /elements\.respondSilently\.checked = false/);
});

test("the request composer accepts one bounded CSV, vCard, or text attachment", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="request-file"[^>]+accept="\.csv,\.vcf,\.txt,text\/csv,text\/vcard,text\/x-vcard,text\/plain"/);
  assert.match(application, /\/api\/request-files\?filename=/);
  assert.match(application, /lowerName\.endsWith\("\.vcf"\) \? "text\/vcard"/);
  assert.match(application, /JSON\.stringify\(\{ text, primaryFileId, runLimits: pendingRunLimits \}\)/);
  assert.match(server, /receiveTextAttachment/);
  assert.match(server, /url\.pathname === "\/api\/request-files"/);
  assert.match(server, /ledger\.createRequest\(\{ text, channel: "web", primaryFileId, runLimits \}\)/);
});

test("the request composer can apply one-shot tool and time limits", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="run-limits-button"/);
  assert.match(document, /id="run-limits-dialog"/);
  assert.match(document, /id="run-tool-call-limit"/);
  assert.match(document, /id="run-tool-calls-unlimited"/);
  assert.match(document, /id="run-time-limit-minutes"/);
  assert.match(document, /id="run-time-unlimited"/);
  assert.match(application, /function applyRunLimits/);
  assert.match(application, /runLimits: pendingRunLimits/);
  assert.match(application, /pendingRunLimits = null/);
  assert.match(server, /normalizeRunLimits\(body\.runLimits\)/);
});

test("the request feed can start a new native model conversation without clearing application history", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="new-conversation"/);
  assert.match(document, /class="conversation-separator"[^>]+aria-label="New conversation"[^>]+hidden/);
  assert.match(application, /api\("\/api\/conversation\/reset", \{ method: "POST" \}\)/);
  assert.match(application, /request\.conversationStarted/);
  assert.match(server, /ledger\.resetModelConversation/);
  assert.match(server, /ledger\.unfinishedRequestCount/);
});

test("the request feed loads ten entries by default and offers larger limits", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /<option value="10" selected>10 requests<\/option>/);
  assert.match(document, /<option value="100">100 requests<\/option>/);
  assert.match(application, /const limit = Number\(elements\.requestLimit\.value\) \|\| 10/);
  assert.match(application, /api\(`\/api\/requests\?limit=\$\{limit\}`\)/);
  assert.match(application, /elements\.requestLimit\.addEventListener\("change"/);
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

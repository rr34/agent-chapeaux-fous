import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set(["node_modules", ".git", "data", "media", ".venv"]);
const excludedFiles = new Set([".env"]);
const excludedRelativeFiles = new Set([
  "db/mariadb/0001-baseline.sql",
  "db/schema-semantics.json",
  "text.json",
]);

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
  assert.ok(baseInstructions.length < 4000, `universal prompt grew to ${baseInstructions.length} characters`);
  assert.match(baseInstructions, /You are Chapeaux Fous/);
  assert.match(baseInstructions, /your only self-name/);
  assert.match(baseInstructions, /Never infer or\s+announce a hat the user did not speak/);
  assert.match(baseInstructions, /inspect its metadata, visible structure,\s+headers, and relevant records/);
  assert.match(baseInstructions, /never ask the user to\s+identify information plainly visible in the attachment/);
  assert.match(baseInstructions, /original requested outcome and full scope authoritative/);
  assert.match(baseInstructions, /missing information as\s+parameters for the original task/);
  assert.match(baseInstructions, /accepts your offered action,\s+perform it/);
  assert.match(baseInstructions, /ask\s+for the same confirmation again/);
  assert.match(baseInstructions, /never\s+repeat an identical failed call/);
  assert.match(baseInstructions, /same error\s+recurs after a relevant correction, stop and report the blocker/);
  assert.match(baseInstructions, /genuinely new validation errors while the tool budget allows/);
  assert.match(baseInstructions, /follow the tool's own contract for\s+validation, atomicity, partial success, and safe replay/);
  assert.doesNotMatch(baseInstructions, /atomic batch validation or import/);
  assert.match(baseInstructions, /perform it instead of continuing open-ended diagnostics/);
  assert.match(baseInstructions, /compare the outcome the user requested with what the tool results actually\s+prove/);
  assert.match(baseInstructions, /If a safe, relevant tool action remains, continue/);
  assert.match(instructions, /personal to-dos/);
  assert.match(instructions, /one `todo_update` call/);
  assert.match(instructions, /one through 500/);
  assert.match(instructions, /Do not spend one model tool call per task/);
  assert.match(instructions, /call\s+`history_range`/);
  assert.match(instructions, /date and\s+topic are filtered in one lookup/);
  assert.match(instructions, /stored SQLite field names/);
  assert.match(instructions, /schema-semantic compiler projection/);
  assert.match(instructions, /previous Monday-through-Monday interval/);
  assert.match(instructions, /never ask the user to\s+write RRULE syntax/);
  assert.match(instructions, /personal-log tools/);
  assert.match(instructions, /complete natural-language log\s+content/);
  assert.match(instructions, /use `log_import` in bounded batches/);
  assert.match(instructions, /call `log_update` on each intended entry/);
  assert.match(instructions, /contact_file_import/);
  assert.match(instructions, /full verified file in one\s+call/);
  assert.match(instructions, /Use `contact_import` in bounded batches\s+only/);
  assert.match(instructions, /contact_duplicate_list/);
  assert.match(instructions, /contact_dedupe_clear/);
  assert.match(instructions, /max_groups=500/);
  assert.match(instructions, /do not start by manually merging an arbitrary small batch/);
  assert.match(instructions, /contact_merge/);
  assert.match(instructions, /same\s+`contact_merge\.merges` array for one group or many/);
  assert.match(instructions, /call is atomic/);
  assert.match(instructions, /profile_fact_set/);
  assert.match(instructions, /Do not store IDs, mappings, precision\s+values, quantities/);
  assert.match(instructions, /Pass operational values to the owning domain tool instead/);
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

test("the client exposes a live user manual generated from the explicit hat catalog", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const hatsSvg = fs.readFileSync(path.join(root, "public", "hats.svg"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "config", "hats.json"), "utf8"));

  assert.doesNotMatch(document, /id="hats-view-button"/);
  assert.match(document, /data-view="hats"/);
  assert.match(document, /id="hats-view"/);
  assert.match(document, /id="composer-hats-link"/);
  assert.match(document, /id="agent-mascot"/);
  assert.match(application, /async function refreshHats/);
  assert.match(application, /function renderAgentMascot/);
  assert.match(application, /function hatSvg\(hat\)/);
  assert.doesNotMatch(application, /hats\.svg#hat-/);
  assert.match(application, /text\.textContent = label/);
  assert.match(application, /svg\.append\(crown, brim, text\)/);
  assert.match(styles, /\.agent-hat-shape \{ fill: var\(--accent\); stroke: #ffffff/);
  assert.match(styles, /\.agent-hat-label \{ fill: #ffffff/);
  assert.doesNotMatch(application, /hats\.svg#agent-head|function mascotSvg/);
  assert.doesNotMatch(hatsSvg, /id="agent-head"/);
  assert.match(application, /target\.hidden = explicitHats\.length === 0/);
  assert.match(application, /api\("\/api\/hats"\)/);
  assert.match(application, /hat\.tools/);
  assert.match(server, /url\.pathname === "\/api\/hats"/);
  assert.match(server, /\["\/hats\.svg", \["hats\.svg", "image\/svg\+xml"\]\]/);
  assert.match(server, /hatCatalog\.publicManual\(registry\.toolDefinitions\(\), capabilityForTool\)/);
  assert.equal(catalog.hats.some(({ id, capability }) => id === "weatherman" && capability === "integration:weather"), true);
  assert.equal(catalog.hats.some(({ id }) => id === "accountant"), false);
  for (const hat of catalog.hats) {
    assert.match(hatsSvg, new RegExp(`id="hat-${hat.icon}"`));
  }
});

test("the client pauses on the final TurnBrief with only Continue and Cancel decisions", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");

  assert.match(document, /class="turn-brief-objective"/);
  assert.match(document, /class="turn-brief-description"/);
  assert.match(document, />Hats \/ capability families</);
  assert.match(document, />Selected tools</);
  assert.match(document, />Requested read-only context views</);
  assert.match(document, /class="turn-brief-continue"[^>]*>Continue<\/button>/);
  assert.match(document, /class="turn-brief-cancel secondary"[^>]*>Cancel<\/button>/);
  assert.doesNotMatch(document, /Change plan/iu);
  assert.match(application, /function decideTurnBrief/);
  assert.match(application, /turn-brief\/\$\{decision\}/);
  assert.match(styles, /\.turn-brief-approval/);
  assert.match(server, /turn-brief\\\/\(continue\|cancel\)/);
});

test("the todo editor builds recurrence without exposing an RRULE input", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /id="todo-repeat-enabled"/);
  assert.match(document, /id="todo-repeat-frequency"/);
  assert.match(document, /id="todo-repeat-weekdays"/);
  assert.match(document, /id="todo-repeat-fields" class="recurrence-fields" hidden/);
  assert.doesNotMatch(document, /Routine RRULE|todo-recurrence-rule/);
});

test("briefings have a dedicated management page without a second execution path", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");

  assert.match(document, /data-view="interactions"[^>]*>Briefings<\/button>/);
  assert.match(document, /id="interactions-view"/);
  assert.match(document, /id="interaction-guide-list"/);
  assert.match(document, /id="interaction-guide-detail"/);
  assert.match(document, /id="interaction-guide-dialog"/);
  assert.match(document, /id="interaction-step-dialog"/);
  assert.match(document, /id="interaction-step-guide"/);
  assert.match(document, /id="delete-interaction-step"[^>]*class="danger editor-delete"[^>]*>Delete exchange<\/button>/);
  assert.doesNotMatch(document, /id="interaction-step-move-dialog"|id="interaction-step-move-target"/);
  assert.match(document, /id="interaction-step-opening"/);
  assert.match(document, /id="interaction-step-contract"/);
  assert.doesNotMatch(document, /id="interaction-step-instructions"|id="interaction-step-completion-mode"/);
  assert.doesNotMatch(document, /id="interaction-guide-text"|id="interaction-step-name"|id="interaction-step-objective"/);
  assert.match(document, /class="save-structured-interaction secondary compact"[^>]*>Make this exchange repeatable<\/button>/);
  assert.match(document, />Briefing exchange<\/p>/);
  assert.match(document, /<label>Opening<textarea/);
  assert.match(document, /<label>Contract JSON<textarea/);
  assert.match(application, /elements\.interactionsView\.hidden = view !== "interactions"/);
  assert.match(application, /function renderInteractionGuideDetail/);
  assert.match(application, /function openInteractionStepEditor/);
  assert.match(application, /function interactionStepIdentity/);
  assert.match(application, /interaction_guide_step_id: step\.id/);
  assert.match(application, /interaction-turn-opening-copy/);
  assert.match(application, /Copy exchange opening/);
  assert.match(application, /copyText\(step\.openingText, event\.currentTarget\)/);
  assert.match(application, /agentReferenceButton\(interactionStepIdentity\(guide, step\), `briefing exchange/);
  assert.match(application, /function deleteEditedInteractionStep/);
  assert.match(application, /function enableInteractionStepDragging/);
  assert.match(application, /interaction-turn-drag-handle/);
  assert.match(application, /interaction-turn-placeholder/);
  assert.match(application, /card\.style\.top/);
  assert.match(application, /pointermove/);
  assert.match(application, /orderedStepIds/);
  assert.match(application, /method: "DELETE"/);
  assert.match(application, /Resume this briefing/);
  assert.match(application, /Start this briefing/);
  assert.match(application, /Resume previous run/);
  assert.match(application, /"Start over"/);
  assert.match(application, /requiresDailyChoice/);
  assert.match(application, /I explicitly choose to keep its unfinished answers/);
  assert.match(application, /I explicitly authorize discarding its unfinished current-run answers/);
  assert.doesNotMatch(application, /Resume in Agent|Start in Agent/);
  assert.doesNotMatch(application, /node\("button", "secondary compact", "Copy exchange identity"\)/);
  assert.doesNotMatch(application, /function openInteractionStepMoveEditor|function moveInteractionStep/);
  assert.doesNotMatch(application, /interaction-turn-instructions|"Agent instructions"/);
  assert.match(application, /Start or resume briefing/);
  assert.match(application, /function saveAsStructuredInteraction/);
  assert.match(application, /structuredGenerationStatuses/);
  assert.match(application, /api\("\/api\/requests"/);
  assert.doesNotMatch(application, /interaction-guides\/\$\{guide\.id\}\/start/);
  assert.match(server, /interactionGuides\.create/);
  assert.match(server, /interactionGuides\.addStep/);
  assert.match(server, /interactionGuides\.updateStep/);
  assert.match(server, /interactionGuides\.deleteStep/);
  assert.match(server, /interactionGuides\.moveStep/);
  assert.match(server, /interactionGuides\.reorderSteps/);
  assert.match(server, /structuredInteractionGenerationPrompt/);
  assert.match(server, /requestKind: "structured_interaction_generation"/);
  assert.match(server, /actorType: "user", actorName: "structured_interactions_page"/);
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
  const serviceWorker = fs.readFileSync(path.join(root, "public", "service-worker.js"), "utf8");
  const status = /<select id="event-status">([\s\S]*?)<\/select>/.exec(document)?.[1] ?? "";
  assert.match(status, /<option value="active">Active<\/option><option value="archived">Archived<\/option>/);
  assert.doesNotMatch(status, />Confirmed<|>Tentative<|>Completed<|>Cancelled</);
  assert.doesNotMatch(document, /id="todo-(?:scheduled|due)"[^>]+type="datetime-local"/);
  assert.match(document, /id="event-start-time"[^>]+placeholder="HH:MM"[^>]+pattern="\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d"/);
  assert.match(document, /id="event-end-time"[^>]+placeholder="HH:MM"[^>]+pattern="\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d"/);
  assert.match(document, /id="event-duration"[^>]+aria-live="polite"/);
  assert.match(document, /id="todo-start-time"[^>]+placeholder="HH:MM"/);
  assert.match(document, /id="todo-due-time"[^>]+placeholder="HH:MM"/);
  assert.match(document, /id="todo-duration-input"[^>]+placeholder="01:00"/);
  assert.match(application, /createTimingEditor/);
  assert.match(server, /\["\/event-date-time\.js", \["event-date-time\.js", "text\/javascript; charset=utf-8"\]\]/);
  assert.match(server, /\["\/presentation-format\.js", \["presentation-format\.js", "text\/javascript; charset=utf-8"\]\]/);
  assert.match(server, /\["\/calendar-grid\.js", \["calendar-grid\.js", "text\/javascript; charset=utf-8"\]\]/);
  assert.match(server, /\["\/timing-editor\.js", \["timing-editor\.js", "text\/javascript; charset=utf-8"\]\]/);
  assert.match(serviceWorker, /"\/calendar-grid\.js"/);
  assert.match(serviceWorker, /"\/presentation-format\.js"/);
  assert.match(serviceWorker, /"\/timing-editor\.js"/);
  assert.match(document, /name="username" autocomplete="username"[^>]+hidden/);
  assert.match(application, /durationMinutes: timing\.duration/);
});

test("the web client manages OAuth and UI-added bearer MCP integrations", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /id="integrations-button"/);
  assert.match(document, /id="integrations-dialog"/);
  assert.match(document, /id="mcp-integration-form"/);
  assert.match(document, /id="mcp-integration-token" type="password"/);
  assert.match(application, /for \(const \[name, integration\] of entries\)/);
  assert.match(application, /\/api\/integrations\/mcp/);
  assert.match(application, /remove-integration/);
  assert.match(application, /oauth\/disconnect/);
});

test("video creation is an explicit select-then-create workflow", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const stylesheet = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="select-video-script-sources"[^>]*>Create video<\/button>/);
  assert.match(document, /id="video-script-selection"[^>]+hidden/);
  const composerIndex = document.indexOf('id="chat-composer"');
  const selectionIndex = document.indexOf('id="video-script-selection"');
  const requestFormIndex = document.indexOf('id="request-form"');
  assert.ok(
    document.indexOf("</main>") < composerIndex
      && composerIndex < selectionIndex
      && selectionIndex < requestFormIndex,
    "video creation controls should be the fixed composer's top extension",
  );
  assert.match(document, /Choose interactions for video/);
  assert.match(document, /Create video from selected/);
  assert.match(application, /function showVideoScriptSelection\(\)[\s\S]+updateComposerHeight\(\);[\s\S]+scrollChatToLatest\(\);/);
  assert.doesNotMatch(application, /videoScriptSelection\.scrollIntoView/);
  assert.match(application, /Create video from \$\{count\}/);
  assert.match(application, /if \(selectingVideoScriptSources\) showVideoScriptSelection\(\);/);
  assert.doesNotMatch(application, /if \(selectingVideoScriptSources\) cancelVideoScriptSelection\(\);/);
  assert.match(application, /refreshVideoScripts\.addEventListener\("click", \(\) => void refreshVideoScripts\(\)\)/);
  assert.doesNotMatch(application, /videoScriptRefreshTimer/);
  assert.match(stylesheet, /\.video-script-source-choice\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(stylesheet, /\.video-script-selection\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(stylesheet, /\.composer-video-script-selection\s*\{[\s\S]+margin: 0 0 \.7rem;/);
  assert.match(document, /id="video-content-dialog"[\s\S]+Add this video to content sequence/);
  assert.match(document, /id="video-content-group"/);
  assert.match(application, /function videoIdentity\(script\)/);
  assert.match(application, /video-script-title-copy/);
  assert.match(application, /copyText\(script\.title, event\.currentTarget\)/);
  assert.match(application, /agentReferenceButton\(videoIdentity\(script\), `generated video/);
  assert.match(application, /`File #\$\{script\.render\.outputFileId\}`/);
  assert.match(application, /`agent-story-\$\{script\.render\.outputFileId\}\.mp4`/);
  assert.match(application, /Add this video to content sequence/);
  assert.match(application, /\/api\/video-scripts\/\$\{videoAddingToContent\.id\}\/content/);
  assert.match(stylesheet, /\.video-script-title-copy/);
  assert.match(server, /videoScriptContentMatch/);
});

test("the interaction video retains the complete chat history as it scrolls", () => {
  const composition = fs.readFileSync(
    path.join(root, "video", "src", "remotion", "InteractionVideo.jsx"),
    "utf8",
  );
  assert.match(composition, /const visibleMessages = scenes\.slice\(0, index \+ 1\);/);
  assert.doesNotMatch(composition, /visibleMessages = [^;]*\.slice\(-\d+\)/);
  assert.match(composition, /previousBubble:\s*\{ opacity: 1 \}/);
  assert.match(composition, /Math\.floor\(760 \/ lineHeight\) \* lineHeight/);
  assert.match(composition, /function HighlightedText/);
  assert.match(composition, /scene\.rawWords/);
  assert.match(composition, /background: "#ffffff"/);
  assert.match(composition, /userBubble:\s*\{[\s\S]+background: USER, color: "#fff"/);
  assert.match(composition, /agentBubble:\s*\{[\s\S]+background: AGENT, color: "#fff"/);
  assert.doesNotMatch(composition, /#f4e86f|#9ac477/);
  assert.match(composition, /alignTimedWordsToDisplay/);
  assert.match(composition, /overflow \* spokenProgress/);
  assert.match(composition, /playbackRate=\{playbackRate\}/);
  assert.match(composition, /damping: 9, stiffness: 185, mass: 0\.65/);
  assert.match(composition, /translateY\(\$\{translateY\}px\) scale\(\$\{scale\}\)/);
});

test("the standalone client restores calendar, routine, grouped to-do, grouped content, and personal log surfaces", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /data-view="calendar"/);
  assert.match(document, /data-view="todos"/);
  assert.match(document, /data-view="routine"[^>]*>Routine<\/button>/);
  assert.match(document, /data-view="todos"[^>]*>To do<\/button>/);
  assert.match(document, /<h2>Routine<\/h2>/);
  assert.match(document, /<h2>To do<\/h2>/);
  assert.match(document, /id="agent-view-button"[^>]*>[\s\S]*?<span>Agent<\/span>[\s\S]*?<\/button>/);
  assert.doesNotMatch(document, /id="view-selector"/);
  for (const view of ["agent", "hats", "calendar", "routine", "todos", "content", "video-scripts", "files", "contacts", "logs", "interactions", "ai-usage"]) {
    assert.match(document, new RegExp(`<button[^>]+data-view="${view}"`));
  }
  assert.ok(document.indexOf('id="agent-view-button"') < document.indexOf('id="settings-menu"'));
  assert.match(document, /id="settings-menu"[\s\S]+<summary aria-label="Menu" title="Menu">[\s\S]+class="menu-icon"[\s\S]+id="select-video-script-sources"[\s\S]+id="refresh"/);
  assert.doesNotMatch(document, /<\/div>\s*<button id="select-video-script-sources" class="top-nav-button/);
  assert.match(application, /Git commit: \$\{commit\}/);
  assert.match(application, /refresh\.addEventListener\("click", async \(\) =>/);
  assert.match(application, /api\("\/api\/integrations\/mcp\/refresh", \{ method: "POST" \}\)/);
  assert.match(server, /url\.pathname === "\/api\/integrations\/mcp\/refresh"/);
  assert.match(document, /data-view="content"/);
  assert.match(document, /data-view="logs"/);
  assert.match(application, /node\("details", "log-entry-disclosure"\)/);
  assert.match(application, /"7-day average"/);
  assert.match(application, /"1-year average"/);
  assert.match(application, /"All-time average"/);
  assert.match(document, /id="content-view"/);
  assert.match(document, /id="content-dialog"/);
  assert.match(document, /id="content-delete"[^>]+hidden>Delete content<\/button>/);
  assert.match(document, /id="content-title"/);
  assert.match(document, /id="content-description"/);
  assert.match(document, /id="content-transcript"/);
  assert.match(document, /<span>Mon<\/span><span>Tue<\/span><span>Wed<\/span><span>Thu<\/span><span>Fri<\/span><span>Sat<\/span><span>Sun<\/span>/);
  assert.match(document, /aria-label="Previous two weeks"/);
  assert.match(document, /aria-label="Next two weeks"/);
  assert.match(document, /aria-label="Previous month"/);
  assert.match(document, /aria-label="Next month"/);
  assert.match(document, /aria-label="Previous year"/);
  assert.match(document, /aria-label="Next year"/);
  assert.match(document, /id="agenda-all-day-list"/);
  assert.match(document, /id="agenda-timeline"/);
  assert.ok(document.indexOf('id="agenda-all-day-list"') < document.indexOf('id="agenda-timeline"'));
  assert.ok(document.indexOf('class="calendar-search-bar') < document.indexOf('class="organizer-heading calendar-range-heading"'));
  assert.doesNotMatch(document, /id="calendar-range-label"/);
  assert.ok(document.indexOf('class="calendar-range-panel') < document.indexOf('class="agenda-panel'));
  assert.match(application, /function twoWeekCalendarRange/);
  assert.match(application, /const gridEnd = addDays\(gridStart, 14\)/);
  assert.match(application, /selectedCalendarDate = addDays\(selectedCalendarDate, -14\)/);
  assert.match(application, /selectedCalendarDate = addDays\(selectedCalendarDate, 14\)/);
  assert.match(application, /selectedCalendarDate = addCalendarMonths\(selectedCalendarDate, -1\)/);
  assert.match(application, /selectedCalendarDate = addCalendarMonths\(selectedCalendarDate, 1\)/);
  assert.match(application, /selectedCalendarDate = addCalendarMonths\(selectedCalendarDate, -12\)/);
  assert.match(application, /selectedCalendarDate = addCalendarMonths\(selectedCalendarDate, 12\)/);
  assert.match(application, /function agendaTimelineTime/);
  assert.match(application, /if \(description\) button\.append\(node\("span", "agenda-item-description", description\)\)/);
  assert.match(styles, /\.agenda-item \.agenda-item-description \{[\s\S]+-webkit-line-clamp: 2;[\s\S]+line-clamp: 2;/);
  assert.match(application, /events\.filter\(\(\{ isAllDay \}\) => isAllDay\)/);
  assert.match(application, /timedEntries = \[/);
  assert.match(application, /renderCalendarGrid/);
  assert.match(document, /id="routine-grid" class="calendar-grid routine-grid"/);
  assert.match(document, /aria-label="Six-week routine calendar"/);
  assert.match(application, /sixWeekMonthDates/);
  assert.match(application, /refreshCalendar/);
  assert.match(application, /refreshTodos/);
  assert.match(application, /refreshContent/);
  assert.match(application, /for \(const button of elements\.navButtons\)[\s\S]+switchView\(button\.dataset\.view\)/);
  assert.match(application, /renderContent/);
  assert.match(application, /elements\.contentDelete\.hidden = !item/);
  assert.match(application, /elements\.contentDelete\.addEventListener\("click"/);
  assert.doesNotMatch(application, /node\("button", "danger compact", "Delete"\)/);
  assert.match(application, /safeContentUrl/);
  assert.match(document, /id="content-group-dialog"/);
  assert.match(document, /id="content-group-name"/);
  assert.match(document, /id="content-group-archive"[^>]*>Archive group<\/button>/);
  assert.match(document, /Every content group supports optional sequence numbers/);
  assert.doesNotMatch(document, /id="new-content"/);
  assert.match(application, /function openContentGroupEditor/);
  assert.match(application, /title\.append\(editGroup\)/);
  assert.match(application, /add\.addEventListener\("click", \(\) => openContentEditor\(null, group\.id\)\)/);
  assert.doesNotMatch(application, /openContentEditor\(\);/);
  assert.match(application, /elements\.contentGroupForm\.addEventListener\("submit", saveContentGroup\)/);
  assert.match(application, /function archiveEditedContentGroup/);
  assert.match(application, /refreshLogs/);
  assert.match(document, /id="log-tracker-unit"[^>]*required/);
  assert.doesNotMatch(document, /id="log-unit"/);
  assert.match(application, /trackerUnit: elements\.logTrackerUnit\.value \|\| null/);
  assert.match(application, /`\$\{entry\.numberValue\} \$\{tracker\.unit\}`/);
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
  assert.match(document, /id="todo-clear-scheduled"[^>]+hidden>Clear schedule<\/button>/);
  assert.ok(document.indexOf('id="todo-start"') < document.indexOf('id="todo-clear-scheduled"'));
  assert.match(application, /function clearTodoScheduledInEditor/);
  assert.match(application, /todoTimingEditor\.clear\(\)/);
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
  assert.match(server, /\/api\/routines\/preview/);
  assert.match(server, /\/api\/routines\/publish/);
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
  const markdown = fs.readFileSync(path.join(root, "public", "markdown.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const terminology = fs.readFileSync(path.join(root, "AGENT-TERMINOLOGY.md"), "utf8");
  assert.match(document, /id="respond-silently" type="checkbox"/);
  assert.doesNotMatch(document, /id="respond-silently"[^>]+checked/);
  assert.match(document, /<span>Respond silently<\/span>/);
  assert.match(application, /prepareSpeechOutput\(respondSilently\)/);
  assert.match(application, /expectSpokenResponse\(created\.requestId, respondSilently\)/);
  assert.match(application, /expectSpokenResponse\(created\.requestId, recordingRespondSilently\)/);
  assert.match(application, /pendingSpokenRequestIds\.has\(request\.requestId\)/);
  assert.match(application, /speakResponse\(request\.response\)/);
  assert.match(application, /markdownToSpeech\(text\)/);
  assert.match(application, /renderMarkdown\(responseMarkdown, request\.response\)/);
  assert.match(markdown, /DOMPurify\.sanitize\(rendered, sanitizerOptions\)/);
  assert.match(markdown, /marked\.parse\(source, \{ gfm: true/);
  assert.match(document, /class="agent-response-markdown"/);
  assert.match(document, /"dompurify": "\/vendor\/dompurify\.js"/);
  assert.match(document, /"marked": "\/vendor\/marked\.js"/);
  assert.match(styles, /\.agent-response-markdown pre/);
  assert.match(server, /"\/vendor\/dompurify\.js"/);
  assert.match(server, /"\/vendor\/marked\.js"/);
  assert.match(application, /responseSilenceStorageKey = "agent-slayer-respond-silently"/);
  assert.match(application, /elements\.respondSilently\.checked = loadResponseSilencePreference\(\)/);
  assert.match(application, /elements\.respondSilently\.addEventListener\("change", saveResponseSilencePreference\)/);
  assert.doesNotMatch(application, /elements\.respondSilently\.checked = false/);
  assert.match(readme, /spoken by default through the\s+web browser's native speech synthesis/);
  assert.match(terminology, /automatically speaks each\s+completed response/);
  assert.doesNotMatch(terminology, /automatic speech playback[^\n]+not/);
});

test("the request composer accepts one image or text attachment and exposes metered AI usage", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(document, /id="request-file"[^>]+accept="[^"]*\.jpg[^"]*image\/jpeg[^"]*text\/csv/);
  assert.match(document, /id="request-image-preview"/);
  assert.match(document, /id="request-existing-file"/);
  assert.match(document, /class="request-file-reference/);
  assert.match(document, /data-view="ai-usage"/);
  assert.match(document, /id="ai-usage-view"/);
  assert.match(document, /id="ai-pricing-form"/);
  assert.match(application, /\/api\/request-files\?filename=/);
  assert.match(application, /Uploaded \$\{uploaded\.originalFilename\} as file #\$\{uploaded\.fileId\}/);
  assert.match(application, /\/api\/files\?limit=200/);
  assert.match(application, /function fileIdentity\(file\)/);
  assert.match(application, /`File: \$\{conciseReferenceText\(file\.title\)\}`/);
  assert.match(application, /referenceCode\(\{ file_id: file\.fileId \}\)/);
  assert.match(application, /function placeIdentityInComposer\(identity\)/);
  assert.match(application, /`In reference to:\\n\$\{identity\}`/);
  assert.match(application, /existingText \? `\$\{reference\}\\n\\n\$\{existingText\}` : `\$\{reference\}\\n\\n`/);
  assert.match(application, /agentReferenceButton\(fileIdentity\(file\), `file/);
  assert.doesNotMatch(application, /Use with next request|Selected for next request/);
  assert.match(application, /request\.attachment/);
  assert.match(application, /jpg: "image\/jpeg"/);
  assert.match(application, /\/api\/ai-usage\?limit=10000/);
  assert.match(application, /aiPricingStorageKey/);
  assert.match(application, /JSON\.stringify\(\{ text, primaryFileId, referencedRequestIds, runLimits: pendingRunLimits \}\)/);
  assert.match(server, /receiveRequestAttachment/);
  assert.match(server, /url\.pathname === "\/api\/request-files"/);
  assert.match(server, /url\.pathname === "\/api\/files"/);
  assert.match(server, /url\.pathname === "\/api\/ai-usage"/);
  assert.match(server, /normalizeReferencedRequestIds\(body\.referencedRequestIds\)/);
});

test("completed exchanges expose a reply action that attaches literal source context", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.mjs"), "utf8");
  const context = fs.readFileSync(path.join(root, "src", "context.mjs"), "utf8");
  assert.match(document, /class="reply-to-exchange reference-in-agent secondary compact"[\s\S]+class="reply-reference-icon"/);
  assert.doesNotMatch(document, /<span>Reply<\/span>/);
  assert.match(document, /M20 19c0-4\.4-3\.6-8-8-8H4/);
  assert.match(application, /function agentReferenceButton\(identity, subject\)/);
  assert.match(application, /`Reference \$\{subject\} in Agent`/);
  assert.match(application, /Added to Agent composer\./);
  assert.match(application, /function replyArrowIcon\(\)/);
  assert.match(application, /button\.append\(replyArrowIcon\(\)\)/);
  assert.match(application, /function replyToExchange\(requestId, requestText\)/);
  assert.match(application, /placeIdentityInComposer\(identity\)/);
  assert.match(application, /function referencedRequestIdsFromComposer\(value\)/);
  assert.match(application, /querySelector\("\.reply-to-exchange"\)\.addEventListener\("click"/);
  assert.match(server, /ledger\.exchangeReference\(referencedRequestId\)/);
  assert.match(server, /metadata: referencedRequestIds\.length \? \{ referencedRequestIds \} : \{\}/);
  assert.match(context, /# Explicitly referenced exchanges/);
  assert.match(context, /referencedExchangesForRequest\(requestId, \{ limit: 8 \}\)/);
});

test("calendar events and tasks use the shared reply reference control", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.match(application, /function todoIdentity\(todo\)/);
  assert.match(application, /referenceCode\(\{ personal_task_id: todo\.id \}\)/);
  assert.match(application, /function calendarEventIdentity\(calendarEvent\)/);
  assert.match(application, /calendar_event_id: numericEventId/);
  assert.match(application, /agentReferenceButton\(todoIdentity\(todo\), `task/);
  assert.match(application, /agentReferenceButton\(calendarEventIdentity\(calendarEvent\), `calendar event/);
  assert.match(application, /const actions = node\("div", "agenda-event-actions"\)/);
  assert.match(styles, /\.agenda-event-actions/);
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

test("the request feed exposes literal workflow steps and per-step token usage", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /class="request-steps" aria-label="Agent steps" hidden/);
  assert.match(application, /function renderRequestSteps/);
  assert.match(application, /step\.tokenUsage\?\.totalTokens/);
  assert.match(application, /request-step-token/);
  assert.match(application, /renderRequestSteps\(node\.querySelector\("\.request-steps"\), request\.steps\)/);
  assert.match(application, /"agent\.step": "AGENT STEP"/);
  assert.match(application, /"turn\.brief": "ACCEPTED TURNBRIEF"/);
  assert.match(application, /"conversation\.state": "ROLLING CONVERSATION STATE"/);
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

test("the request feed loads at least twenty-five entries by default and offers larger limits", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.doesNotMatch(document, /<option value="10">10 requests<\/option>/);
  assert.match(document, /<option value="25" selected>25 requests<\/option>/);
  assert.match(document, /<option value="100">100 requests<\/option>/);
  assert.match(application, /const limit = Number\(elements\.requestLimit\.value\) \|\| 25/);
  assert.match(application, /api\(`\/api\/requests\?limit=\$\{limit\}`\)/);
  assert.match(application, /elements\.requestLimit\.addEventListener\("change"/);
});

test("the agent chat renders chronologically above its composer", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.ok(document.indexOf('<section class="requests"') < document.indexOf('id="chat-composer"'));
  assert.ok(document.indexOf("</main>") < document.indexOf('id="chat-composer"'));
  assert.match(styles, /\.composer \{[\s\S]+position: fixed;[\s\S]+bottom: 0/);
  assert.match(application, /const chronologicalRequests = \[\.\.\.body\.requests\]\.reverse\(\)/);
  assert.match(application, /chronologicalRequests\.forEach\(\(request, index\) =>/);
  assert.match(application, /renderAgentMascot\(elements\.agentMascot, body\.requests\[0\]\?\.explicitHats\)/);
  assert.match(application, /wasFollowingLatest/);
  assert.match(application, /function scrollChatToLatest\(\{ behavior = "auto" \} = \{\}\)/);
  assert.match(application, /latestRequest\.scrollIntoView\(\{ block: "end", behavior \}\)/);
  assert.match(application, /history\.scrollRestoration = "manual"/);
  assert.match(application, /window\.addEventListener\("load", \(\) => scrollChatToLatest\(\)/);
  assert.match(application, /loadRequests\(\{ force: true, followLatest: true \}\)/);
});

test("the chat offers a floating return-to-latest control when scrolled up", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.match(document, /id="scroll-latest"[^>]+aria-label="Scroll to the most recent chat"[^>]+hidden/);
  assert.match(styles, /\.scroll-latest \{[\s\S]+position: fixed;[\s\S]+bottom: calc\(var\(--composer-height, 11rem\) \+ \.7rem\)/);
  assert.match(styles, /\.scroll-latest\[hidden\] \{ display: none; \}/);
  assert.match(application, /const distanceFromBottom = document\.documentElement\.scrollHeight - \(window\.scrollY \+ window\.innerHeight\)/);
  assert.match(application, /window\.addEventListener\("scroll", scheduleScrollLatestButtonUpdate, \{ passive: true \}\)/);
  assert.match(application, /elements\.scrollLatest\.addEventListener\("click", \(\) => scrollChatToLatest\(\{ behavior: "smooth" \}\)\)/);
  assert.match(application, /const durationMs = 360/);
  assert.match(application, /function finishScrollChatToBottom\(\)/);
  assert.match(application, /window\.scrollTo\(0, document\.documentElement\.scrollHeight\)/);
  assert.match(application, /finishScrollChatToBottom\(\)/);
});

test("the chat uses the TLOM light and olive-slate palette", () => {
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.match(styles, /color-scheme: light/);
  assert.match(styles, /--background: #ffffff/);
  assert.match(styles, /--panel-raised: #c9d3bf/);
  assert.match(styles, /--line: #c9d3bf/);
  assert.match(styles, /--muted: #6e7b61/);
  assert.match(styles, /--accent: #4e5b43/);
  assert.match(styles, /--brand-mid: #6e7b61/);
  assert.match(styles, /--brand-light: #c9d3bf/);
  assert.match(styles, /\.request-user-turn \{[\s\S]+background: var\(--brand-mid\)/);
  assert.match(styles, /\.request-agent-turn \{[\s\S]+background: var\(--accent\)/);
});

test("the top navigation uses two rows while retaining narrow-screen overflow", () => {
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.match(styles, /\.topbar-links \{[\s\S]+grid-template-columns: repeat\(6, max-content\)/);
  assert.match(styles, /\.topbar-links \{[\s\S]+grid-template-rows: repeat\(2, minmax\(36px, auto\)\)/);
  assert.match(styles, /\.topbar-links \{[\s\S]+justify-content: safe center/);
  assert.match(styles, /\.topbar-links \{[\s\S]+overflow-x: auto/);
  assert.match(styles, /\.topbar-nav \{[\s\S]+grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.settings-menu \{[\s\S]+place-self: center/);
  assert.match(styles, /\.menu-icon > span \{ height: 2px/);
});

test("the persistent composer uses a compact microphone beside the text box", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.match(document, /class="composer-input-row"[\s\S]+id="request-text"[\s\S]+id="record"[\s\S]+id="send"/);
  assert.match(document, /id="new-conversation"[\s\S]*<\/section>\s*<dialog id="integrations-dialog"/);
  assert.match(styles, /\.record-button \{[\s\S]+width: 46px;[\s\S]+height: 46px/);
  assert.match(application, /new ResizeObserver\(updateComposerHeight\)\.observe\(elements\.composer\)/);
});

test("the composer exposes file upload while the Files screen retains stored-file controls", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const filesView = document.slice(document.indexOf('id="files-view"'), document.indexOf('id="contacts-view"'));
  const composer = document.slice(document.indexOf('id="chat-composer"'), document.indexOf('id="integrations-dialog"'));
  assert.match(filesView, /for="request-file"[\s\S]+id="request-existing-file"[\s\S]+id="file-list"/);
  assert.match(composer, /id="composer-attach-file"[\s\S]+id="request-file"[\s\S]+id="request-text"/);
  assert.match(composer, /id="composer-file-selection"[\s\S]+id="composer-remove-request-file"/);
  assert.doesNotMatch(composer, /id="request-existing-file"/);
  assert.match(composer, /class="composer-input-row"[\s\S]+class="composer-actions"/);
  assert.match(application, /elements\.composerAttachFile\.addEventListener\("click", \(\) => elements\.requestFile\.click\(\)\)/);
  assert.match(application, /elements\.composerRemoveRequestFile\.addEventListener\("click", clearRequestFileSelection\)/);
  assert.match(application, /elements\.filesView\.hidden = view !== "files"/);
  assert.match(application, /if \(view === "files"\) void loadFiles\(\)/);
});

test("each chat exchange offsets the user request and groups metrics with the response", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  assert.ok(document.indexOf('class="request-user-turn"') < document.indexOf('class="request-agent-turn"'));
  assert.match(document, /class="request-user-turn"[\s\S]+class="user-request"[\s\S]+class="request-meta request-user-meta"/);
  assert.match(document, /class="request-agent-turn"[\s\S]+class="agent-response"[\s\S]+class="response-metrics"[\s\S]+class="request-status"[\s\S]+class="request-elapsed"[\s\S]+class="request-usage"/);
  assert.match(styles, /\.request-user-turn \{[\s\S]+justify-self: end/);
  assert.match(styles, /\.request-agent-turn \{[\s\S]+justify-self: start/);
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
  const presentation = fs.readFileSync(path.join(root, "public", "presentation-format.js"), "utf8");
  assert.match(application, /import \{ formatDisplayDate, formatDisplayTime, formatLocalDate \} from "\.\/presentation-format\.js"/);
  assert.match(presentation, /export function formatDisplayDate/);
  assert.match(presentation, /export function formatDisplayTime/);
  assert.match(presentation, /weekday: "short", day: "2-digit", month: "short", year: "numeric"/);
  assert.match(presentation, /hour: "2-digit", minute: "2-digit", hourCycle: "h23"/);
  assert.match(presentation, /`\$\{dateLabel\} at \$\{formatDisplayTime\(date, \{ timeZone, fallback \}\)\}`/);
  assert.match(application, /formatDisplayDate\(value, \{ includeTime: false, timeZone \}\)/);
  assert.match(application, /return formatDisplayDate\(value\)/);
});

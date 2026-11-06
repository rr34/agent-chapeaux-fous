import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set(["node_modules", ".git", "media", ".venv", "build", "ui"]);
const excludedFiles = new Set([".env"]);
const excludedRelativeFiles = new Set([
  "db/mariadb/0001-baseline.sql",
  // Storage migrations may name retained historical columns, just like the baseline.
  "db/migrations.sql",
  "text.json",
  // This is an infrastructure-history document, not part of the standalone application tree.
  "serverstructure.md",
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

test("the standalone tree contains no retired database-engine references", () => {
  const forbidden = ["sql", "ite"].join("");
  const matches = [];
  for (const filename of files(root)) {
    if (["text.json", "serverstructure.md"].includes(path.relative(root, filename))) continue;
    const content = fs.readFileSync(filename);
    if (content.includes(0)) continue;
    if (content.toString("utf8").toLowerCase().includes(forbidden)) matches.push(path.relative(root, filename));
  }
  assert.deepEqual(matches, []);
});

test("base instructions stay universal while capability fragments retain domain behavior", () => {
  const baseInstructions = fs.readFileSync(path.join(root, "config", "system-prompt.md"), "utf8");
  const capabilityRoot = path.join(root, "config", "capabilities");
  const instructions = fs.readdirSync(capabilityRoot)
    .filter((directory) => fs.statSync(path.join(capabilityRoot, directory)).isDirectory())
    .sort()
    .map((directory) => fs.readFileSync(
      path.join(capabilityRoot, directory, "guidance.md"), "utf8",
    ))
    .join("\n");
  assert.doesNotMatch(baseInstructions, /TLOM/i);
  assert.doesNotMatch(baseInstructions, /personal to-dos|native JMAP|contact_dedupe_clear/);
  assert.ok(baseInstructions.length < 6000, `universal prompt grew to ${baseInstructions.length} characters`);
  assert.match(baseInstructions, /You are Time v3 Agent/);
  assert.match(baseInstructions, /your only self-name/);
  assert.match(baseInstructions, /Never infer or\s+announce a hat the user did not speak/);
  assert.match(baseInstructions, /inspect its metadata, visible structure,\s+headers, and relevant records/);
  assert.match(baseInstructions, /never ask the user to\s+identify information plainly visible in the attachment/);
  assert.match(baseInstructions, /declared lifecycle for ordinary delete, remove, and archive\s+requests/);
  assert.match(baseInstructions, /never call retained inactive history\s+permanently erased/);
  assert.match(baseInstructions, /unresolved material user\s+choice/);
  assert.match(baseInstructions, /tools do not supply preferences/);
  assert.match(baseInstructions, /original requested outcome and full scope authoritative/);
  assert.match(baseInstructions, /missing information as\s+parameters for the original task/);
  assert.match(baseInstructions, /accepts your offered action,\s+perform it/);
  assert.match(baseInstructions, /ask\s+for the same confirmation again/);
  assert.match(baseInstructions, /never\s+repeat an identical failed call/);
  assert.match(baseInstructions, /same error\s+recurs after a relevant correction, stop and report the blocker/);
  assert.match(baseInstructions, /Continue\s+only when a concrete correction addresses the observed failure/);
  assert.match(baseInstructions, /follow the tool's own contract for\s+validation, atomicity, partial success, and safe replay/);
  assert.doesNotMatch(baseInstructions, /atomic batch validation or import/);
  assert.match(baseInstructions, /perform it instead of continuing open-ended diagnostics/);
  assert.match(baseInstructions, /compare the outcome the user requested with what the tool results actually\s+prove/);
  assert.match(baseInstructions, /If a safe, relevant tool action remains, continue/);
  assert.match(instructions, /personal to-dos/);
  assert.match(instructions, /one `todo_update` call/);
  assert.match(instructions, /call\s+`history_range`/);
  assert.match(instructions, /date and\s+topic are filtered in one lookup/);
  assert.match(instructions, /stored database field names/);
  assert.match(instructions, /tool contracts explain their meaning/);
  assert.match(instructions, /do not request the full schema catalog by\s+default/);
  assert.match(instructions, /previous Monday-through-Monday interval/);
  assert.match(instructions, /never ask the user to\s+write\s+RRULE syntax/);
  assert.match(instructions, /personal-journal tools/);
  assert.match(instructions, /complete natural-language journal\s+content/);
  assert.match(instructions, /use `journal_import` in bounded batches/);
  assert.match(instructions, /call `journal_update` on each intended entry/);
  assert.match(instructions, /contact_file_import/);
  assert.match(instructions, /full verified file in one\s+call/);
  assert.match(instructions, /Use `contact_import` in bounded batches\s+only/);
  assert.match(instructions, /contact_address_update/);
  assert.match(instructions, /action=add/);
  assert.match(instructions, /second home, work, mailing, or billing address/);
  assert.match(instructions, /never use `contact_import` to represent\s+an address correction/);
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
  assert.match(instructions, /Use `web_search` for bounded public discovery/);
  assert.match(instructions, /Relevant profile types/);
  assert.doesNotMatch(instructions, /no active preferred_name fact exists/);
});

test("only the React application is retained as the product interface", () => {
  for (const legacy of ["index.html", "app.js", "styles.css", "timing-editor.js", "calendar-grid.js", "markdown.js"]) {
    assert.equal(fs.existsSync(path.join(root, "public", legacy)), false, legacy);
  }
  const staticFiles = fs.readFileSync(path.join(root, "src", "static-files.mjs"), "utf8");
  assert.match(staticFiles, /\["\/app", \[path\.join\(uiRoot, "index\.html"\)/);
  assert.doesNotMatch(staticFiles, /"\/app\.js"|"\/styles\.css"|"\/timing-editor\.js"|"\/calendar-grid\.js"|"\/markdown\.js"/);
});

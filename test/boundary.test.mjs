import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set(["node_modules", ".git", "data", "media", ".venv"]);
const excludedFiles = new Set([".env"]);
const excludedRelativeFiles = new Set(["db/schema-semantics.json"]);

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
  assert.match(instructions, /personal-log tools/);
  assert.match(instructions, /complete natural-language log\s+content/);
  assert.match(instructions, /log_import in bounded\s+batches/);
  assert.match(instructions, /profile_fact_set/);
  assert.match(instructions, /profile_fact_delete/);
  assert.match(instructions, /open-ended\s+collection/);
  assert.match(instructions, /Relevant profile types/);
  assert.doesNotMatch(instructions, /no active preferred_name fact exists/);
});

test("the web client renders every OAuth integration instead of selecting only one", () => {
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(document, /id="integrations"/);
  assert.match(application, /\.filter\(\(\[, integration\]\) => integration\.oauth\)/);
  assert.doesNotMatch(application, /\.find\(\(\[, integration\]\) => integration\.oauth\)/);
  assert.match(application, /for \(const \[name, integration\] of oauthEntries\)/);
});

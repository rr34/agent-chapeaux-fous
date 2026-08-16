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
  assert.match(instructions, /profile_fact_set/);
  assert.match(instructions, /profile_fact_delete/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set(["node_modules", ".git"]);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

test("the standalone tree contains no previous runtime-host references", () => {
  const forbidden = ["open", "claw"].join("");
  const matches = [];
  for (const filename of files(root)) {
    const content = fs.readFileSync(filename);
    if (content.includes(0)) continue;
    if (content.toString("utf8").toLowerCase().includes(forbidden)) matches.push(path.relative(root, filename));
  }
  assert.deepEqual(matches, []);
});

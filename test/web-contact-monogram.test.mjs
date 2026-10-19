import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "web/src/components/object-cards/contact-monogram.ts");
const executableSource = fs.readFileSync(sourcePath, "utf8")
  .replace("displayName: string", "displayName");

test("contact monograms use the first and last name initials", async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}`;
  const { contactMonogram } = await import(moduleUrl);

  assert.equal(contactMonogram("Jermaine Fox"), "JF");
  assert.equal(contactMonogram("Jermaine Morgan Fox"), "JF");
  assert.equal(contactMonogram("Prince"), "PR");
  assert.equal(contactMonogram("  Jermaine   Fox  "), "JF");
  assert.equal(contactMonogram(""), "");
});

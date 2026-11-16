import assert from "node:assert/strict";
import test from "node:test";
import { lcdViewport, renderLcdDocument, renderLcdMessage, wrapLcdText } from "../web/src/lcd-document.ts";

test("the web LCD renderer wraps with the node's twenty-cell contract", () => {
  assert.deepEqual(wrapLcdText("A message that wraps cleanly."), ["A message that wraps", "cleanly."]);
  assert.deepEqual(wrapLcdText("abcdefghijklmnopqrstuvwxyz"), ["abcdefghijklmnopqrst", "uvwxyz"]);
});

test("LCD links reserve the twentieth cell for a right-facing marker", () => {
  const rows = renderLcdDocument("", [{ label: "nineteen characters!", target: "page:2" }]);
  assert.deepEqual(rows, ["nineteen characters>"]);
  assert.equal(rows[0].length, 20);
});

test("the LCD viewport is always exactly twenty by four", () => {
  const viewport = lcdViewport(renderLcdDocument("one\ntwo\nthree\nfour\nfive"), 1);
  assert.equal(viewport.offset, 1);
  assert.equal(viewport.rows.length, 4);
  assert.equal(viewport.rows.every((row) => row.length === 20), true);
});

test("message direction consumes two cells only on the first LCD row", () => {
  assert.deepEqual(
    renderLcdMessage("123456789012345678 12345678901234567890", "inbound"),
    ["← 123456789012345678", "12345678901234567890"],
  );
  assert.equal(renderLcdMessage("Sent message", "outbound")[0], "→ Sent message");
});

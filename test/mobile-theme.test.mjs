import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const theme = fs.readFileSync(new URL("../mobile/src/theme.ts", import.meta.url), "utf8");
const music = fs.readFileSync(new URL("../mobile/src/MusicPlayerModal.tsx", import.meta.url), "utf8");

test("mobile uses the canonical purple palette without legacy red player surfaces", () => {
  assert.match(theme, /background: '#0E001E'/u);
  assert.match(theme, /accent: '#8F7BA3'/u);
  assert.doesNotMatch(theme, /#E63E3E|#B82F2F/u);
  assert.doesNotMatch(music, /#351719|#2A1D1A|#FF4545/u);
});

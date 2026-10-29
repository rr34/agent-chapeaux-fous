import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const player = fs.readFileSync(new URL("../mobile/src/MusicPlayerModal.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../mobile/src/api.ts", import.meta.url), "utf8");

test("mobile library selections only add releases, works, or tracks to one concert", () => {
  assert.match(player, /<Text style=\{styles\.addButtonText\}>\+<\/Text>/u);
  assert.match(player, /onPress=\{\(\) => onAdd\(group\.files\)\}/u);
  assert.match(player, /onPress=\{\(\) => onAdd\(work\.files\)\}/u);
  assert.match(player, /onPress=\{\(\) => onAdd\(\[file\]\)\}/u);
  assert.doesNotMatch(player, /PLAY ALBUM|PLAY WORK|onPlay=/u);
  assert.match(player, /That music is already in the concert/u);
});

test("mobile playback starts only from the visible concert queue", () => {
  const add = player.slice(player.indexOf("const add ="), player.indexOf("const clear ="));
  assert.doesNotMatch(add, /player\.play|playAt|loadItem/u);
  assert.match(player, /const playOrPause = \(\) =>/u);
  assert.match(player, /void playAt\(0\)/u);
  assert.match(player, /Concert complete\. Playback stopped\./u);
  assert.match(player, /Concert cleared\./u);
  assert.match(player, />UNDO<\/Text>/u);
});

test("concert queue discloses and streams temporary AI-voice introductions", () => {
  assert.match(player, /An AI voice appears before every track/u);
  assert.match(player, /AI VOICE · WILL GENERATE/u);
  assert.match(player, /generateMusicNarration\(settings, item\.text\)/u);
  assert.match(api, /'\/api\/music\/narrations'/u);
  assert.match(api, /narrationSource/u);
});

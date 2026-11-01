import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const player = fs.readFileSync(new URL("../web/src/components/AdditionalScreens.tsx", import.meta.url), "utf8");

test("the web music library can only add music to the concert", () => {
  const library = player.slice(player.indexOf("export function MusicScreen"));
  assert.match(library, /Library selections never start playback\./u);
  assert.match(library, /aria-label=\{`Add \$\{musicTrackTitle\(track\)\} to concert`\}/u);
  assert.match(library, /player\.enqueue\(\[track\]\)/u);
  assert.doesNotMatch(library, /player\.play\(track\)/u);
  assert.doesNotMatch(library, />Play<\/button>/u);
});

test("web playback starts and advances only through the assembled concert", () => {
  const add = player.slice(player.indexOf("const enqueue ="), player.indexOf("const start ="));
  assert.match(add, /concertItems\(additions, fields\)/u);
  assert.doesNotMatch(add, /playAt|audio\.current.*play/u);
  assert.match(player, /const start = \(\) => \{/u);
  assert.match(player, /void playAt\(0\)/u);
  assert.match(player, /onEnded=\{\(\) => \{ setPlaying\(false\); void playAt\(index \+ 1\); \}\}/u);
  assert.match(player, /Concert complete\. Playback stopped\./u);
});

test("the web concert has an explicit high-contrast playback timeline", () => {
  const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  assert.match(player, /aria-label="Playback position"/u);
  assert.match(player, /--music-progress/u);
  assert.match(player, /formatPlaybackTime\(playbackSeconds\)/u);
  assert.match(styles, /\.music-player-timeline input \{[^}]*linear-gradient\(to right, #b64c2d[^}]*#2f382a/su);
  assert.match(styles, /\.music-player-timeline input::-webkit-slider-thumb/u);
  assert.match(styles, /\.music-player-timeline input::-moz-range-progress/u);
});

test("web narration defaults to 70% and stays independent from full-volume music", () => {
  assert.match(player, /const \[voiceVolume, setVoiceVolume\] = useState\(0\.7\)/u);
  assert.match(player, /audio\.current\.volume = current\.kind === "narration" \? voiceVolume : 1/u);
  assert.match(player, /aria-label="AI voice volume"/u);
  assert.match(player, /min="0" max="100" step="10"/u);
  assert.match(player, /Relative to music · adjustable during playback/u);
});

test("the web concert floats at a stable bottom height and copies its track description", () => {
  const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  assert.match(player, /function concertDescriptionText\(files: MusicFile\[\]\)/u);
  assert.match(player, /navigator\.clipboard\.writeText\(text\)/u);
  assert.match(player, /document\.execCommand\("copy"\)/u);
  assert.match(player, /await copyTextToClipboard\(text\)/u);
  assert.match(player, />Copy concert description<\/button>/u);
  assert.match(styles, /\.music-screen \.concert-queue \{[^}]*position: fixed;[^}]*bottom:[^}]*height:[^}]*overflow-y: auto;/su);
});

test("the web concert discloses and generates AI introductions", () => {
  assert.match(player, /kind: "narration"/u);
  assert.match(player, /"\/api\/music\/narrations"/u);
  assert.match(player, /An AI voice introduces every track\./u);
  assert.match(player, /AI voice · Will generate/u);
  assert.match(player, /concert-program-narration/u);
  assert.match(player, /spoken metadata field/u);
});

test("the web concert groups consecutive selections while keeping narration and music visible", () => {
  assert.match(player, /function concertProgramGroups/u);
  assert.match(player, /last\?\.identity === identity/u);
  assert.match(player, /concert-program-group/u);
  assert.match(player, /key=\{`narration:\$\{file\.fileId\}`\}/u);
  assert.match(player, /key=\{`music:\$\{file\.fileId\}`\}/u);
});

test("the web concert freezes its program once playback starts", () => {
  assert.match(player, /if \(hasStarted\) return;/u);
  assert.match(player, /disabled=\{player\.hasStarted\}/u);
  assert.match(player, /This concert is fixed while it is playing\. Clear it to build another\./u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseProbedDurationMs, voiceMessageMaximumDurationMs } from "../src/voice-message-media.mjs";

test("voice message duration parsing uses milliseconds", () => {
  assert.equal(parseProbedDurationMs('{"format":{"duration":"12.345"}}'), 12_345);
  assert.equal(voiceMessageMaximumDurationMs, 60_000);
});

test("voice message duration parsing rejects missing audio duration", () => {
  assert.throws(() => parseProbedDurationMs('{"format":{}}'), /measurable audio duration/u);
  assert.throws(() => parseProbedDurationMs("not json"), /not valid audio/u);
});

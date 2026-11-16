import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  parseProbedDurationMs,
  receiveVoiceMessage,
  voiceMessageMaximumDurationMs,
} from "../src/voice-message-media.mjs";

test("voice message duration parsing uses milliseconds", () => {
  assert.equal(parseProbedDurationMs('{"format":{"duration":"12.345"}}'), 12_345);
  assert.equal(voiceMessageMaximumDurationMs, 60_000);
});

test("voice message duration parsing rejects missing audio duration", () => {
  assert.throws(() => parseProbedDurationMs('{"format":{}}'), /measurable audio duration/u);
  assert.throws(() => parseProbedDurationMs("not json"), /not valid audio/u);
});

test("voice message canonicalization repairs playable input without duration metadata", async () => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "voice-message-test-"));
  const request = Readable.from([Buffer.from("playable streaming audio")]);
  request.headers = { "content-type": "audio/ogg" };
  let probeCount = 0;
  const run = async (command, arguments_) => {
    if (command === "ffprobe" && probeCount++ === 0) {
      throw new Error("duration metadata unavailable");
    }
    if (command === "ffmpeg") {
      await fsp.writeFile(arguments_.at(-1), Buffer.from("canonical Ogg/Opus"));
      return { stdout: "", stderr: "" };
    }
    return { stdout: '{"format":{"duration":"12.345"}}', stderr: "" };
  };
  try {
    const recording = await receiveVoiceMessage(request, { mediaRoot, run });
    assert.equal(recording.durationMs, 12_345);
    assert.equal(recording.mimeType, "audio/ogg");
    assert.equal(await fsp.readFile(recording.absoluteFilename, "utf8"), "canonical Ogg/Opus");
  } finally {
    await fsp.rm(mediaRoot, { recursive: true, force: true });
  }
});

test("voice message conversion failures retain a stable code and bounded tool detail", async () => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "voice-message-error-test-"));
  const request = Readable.from([Buffer.from("playable streaming audio")]);
  request.headers = { "content-type": "audio/ogg" };
  let probeCount = 0;
  const run = async (command) => {
    if (command === "ffprobe" && probeCount++ === 0) throw new Error("metadata unavailable");
    throw Object.assign(new Error("conversion exited 1"), {
      stderr: "Invalid data found when processing input\n",
    });
  };
  try {
    await assert.rejects(
      receiveVoiceMessage(request, { mediaRoot, run }),
      (error) => error.code === "VOICE_CONVERT"
        && error.diagnosticDetail === "Invalid data found when processing input",
    );
  } finally {
    await fsp.rm(mediaRoot, { recursive: true, force: true });
  }
});

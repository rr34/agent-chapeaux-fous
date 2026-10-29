import assert from "node:assert/strict";
import test from "node:test";
import { inspectMp3, mp3DurationMs } from "../src/mp3-metadata.mjs";

function mpeg1Layer3Frame() {
  const frame = Buffer.alloc(417);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame);
  return frame;
}

test("MP3 duration is measured from MPEG frames when ID3 TLEN is absent", () => {
  const bytes = Buffer.concat(Array.from({ length: 100 }, mpeg1Layer3Frame));
  assert.equal(mp3DurationMs(bytes), 2_612);
  assert.equal(inspectMp3(bytes).durationMs, 2_612);
});

test("MP3 duration remains unknown for a truncated frame", () => {
  assert.equal(mp3DurationMs(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0])), null);
});

test("ID3 duration metadata never overrides the measured audio", () => {
  const framePayload = Buffer.concat(Array.from({ length: 100 }, mpeg1Layer3Frame));
  const text = Buffer.concat([Buffer.from([3]), Buffer.from("999999", "utf8")]);
  const frameSize = Buffer.alloc(4);
  frameSize.writeUInt32BE(text.length);
  const id3Frame = Buffer.concat([Buffer.from("TLEN", "ascii"), frameSize, Buffer.alloc(2), text]);
  const tagSize = Buffer.from([0, 0, 0, id3Frame.length]);
  const bytes = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.from([3, 0, 0]), tagSize, id3Frame, framePayload]);
  assert.equal(inspectMp3(bytes).durationMs, 2_612);
});

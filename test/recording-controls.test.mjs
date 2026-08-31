import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an active voice recording can be cancelled without uploading it", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const stopHandler = application.slice(
    application.indexOf('recorder.addEventListener("stop"'),
    application.indexOf("recorder.start(1000)"),
  );

  assert.match(document, /id="cancel-recording"[^>]+aria-label="Cancel recording"[^>]+hidden/);
  assert.match(application, /elements\.cancelRecording\.hidden = false/);
  assert.match(application, /elements\.cancelRecording\.addEventListener\("click"/);
  assert.match(application, /recordingCancelled = true;[\s\S]+recorder\.stop\(\)/);
  assert.ok(stopHandler.indexOf("if (recordingCancelled)") < stopHandler.indexOf('api("/api/voice"'));
  assert.match(stopHandler, /Recording cancelled\./);
});

test("the recorder starts as a microphone and shows live input while recording", () => {
  const document = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const application = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

  assert.match(document, /id="record"[^>]+aria-label="Start recording"[\s\S]+class="record-microphone"/);
  assert.match(document, /id="record-meter"[^>]+class="record-meter"[\s\S]+<span><\/span>/);
  assert.match(styles, /\.record-button\.recording \.record-microphone \{ display: none; \}/);
  assert.match(styles, /\.record-button\.recording \.record-meter \{ display: flex; \}/);
  assert.match(application, /createMediaStreamSource\(stream\)/);
  assert.match(application, /getByteTimeDomainData\(recordingLevelData\)/);
  assert.match(application, /recordLabel\.textContent = "Recording · tap to send"/);
  assert.match(application, /record\.setAttribute\("aria-label", "Send recording"\)/);
});

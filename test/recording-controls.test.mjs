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

  assert.match(document, /id="cancel-recording"[^>]+hidden[^>]*>Cancel recording<\/button>/);
  assert.match(application, /elements\.cancelRecording\.hidden = false/);
  assert.match(application, /elements\.cancelRecording\.addEventListener\("click"/);
  assert.match(application, /recordingCancelled = true;[\s\S]+recorder\.stop\(\)/);
  assert.ok(stopHandler.indexOf("if (recordingCancelled)") < stopHandler.indexOf('api("/api/voice"'));
  assert.match(stopHandler, /Recording cancelled\./);
});

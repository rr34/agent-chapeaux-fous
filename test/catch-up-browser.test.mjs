import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { defaultCatchUpSettings, catchUpScopeFromSettings, catchUpRequestText } from "../public/catch-up-settings.js";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function submitTextRequest("), app.indexOf('\nelements.form.addEventListener("submit"'));
function browser(settings) {
  const calls = [];
  const elements = {
    send: {}, catchUp: {}, catchUpStatus: {}, status: {}, respondSilently: { checked: true },
    text: { value: "Keep my draft" }, requestFile: { value: "attachment.pdf" }, requestExistingFile: { value: "7" },
  };
  const context = vm.createContext({
    elements, recorder: null, storedFiles: [], pendingRunLimits: null,
    readCatchUpSettings: () => settings,
    catchUpScopeFromSettings: settings => catchUpScopeFromSettings(settings, new Date("2026-09-10T16:00:00Z"), "America/New_York"),
    catchUpRequestText, prepareSpeechOutput() {}, expectSpokenResponse() {}, updateRunLimitsSummary() {},
    switchView: view => calls.push({ view }), loadRequests: async () => {}, loadFiles: async () => {},
    api: async (url, request) => { calls.push({ url, request }); return { requestId: "check-in" }; },
  });
  vm.runInContext(source, context);
  return { context, calls, elements };
}
test("Start submits the selected catch-up as an ordinary request and preserves the composer draft and attachment", async () => {
  const { context, calls, elements } = browser({ ...defaultCatchUpSettings, logsDay: "yesterday", planEnabled: false });
  await context.submitTextRequest({ catchUp: true });
  const sent = calls.find(call => call.url);
  assert.equal(sent.url, "/api/requests");
  assert.equal(sent.request.method, "POST");
  const body = JSON.parse(sent.request.body);
  assert.match(body.text, /Complete journal logs for 2026-09-09/);
  assert.match(body.text, /Event planning: disabled/);
  assert.match(body.text, /Past-event review: disabled/);
  assert.match(body.text, /one question at a time and wait/);
  assert.equal(body.primaryFileId, null);
  assert.deepEqual(body.referencedRequestIds, []);
  assert.equal(elements.text.value, "Keep my draft");
  assert.equal(elements.requestFile.value, "attachment.pdf");
  assert.equal(elements.requestExistingFile.value, "7");
  assert.ok(calls.some(call => call.view === "agent"));
  assert.equal(elements.catchUp.disabled, false);
});
test("invalid catch-up settings show an error in Check-in without submitting or clearing the draft", async () => {
  const { context, calls, elements } = browser({ ...defaultCatchUpSettings, logsDay: "date", logsDate: "" });
  await context.submitTextRequest({ catchUp: true });
  assert.deepEqual(calls, []);
  assert.match(elements.catchUpStatus.textContent, /valid calendar date/);
  assert.equal(elements.text.value, "Keep my draft");
});

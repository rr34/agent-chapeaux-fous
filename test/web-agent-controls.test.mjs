import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const objectMentionInput = fs.readFileSync(new URL("../web/src/components/ObjectMentionInput.tsx", import.meta.url), "utf8");
const types = fs.readFileSync(new URL("../web/src/types.ts", import.meta.url), "utf8");

test("the Agent composer stays fixed and is rendered by the workspace", () => {
  assert.match(app, /<main className="workspace">\{screen\}<\/main><AgentComposer/);
  assert.match(app, /function AgentComposer\(/);
  assert.match(styles, /\.composer \{[^}]*position: fixed[^}]*bottom:/s);
  assert.match(styles, /\.workspace \{[^}]*padding:[^;}]*170px/s);
});

test("the Agent conversation initially scrolls to its newest interaction", () => {
  const agentScreen = app.slice(app.indexOf("function AgentScreen("), app.indexOf("function CalendarScreen("));
  assert.match(agentScreen, /const initialScrollPending = useRef\(true\)/);
  assert.match(agentScreen, /if \(loading \|\| error \|\| !data \|\| !initialScrollPending\.current\) return/);
  assert.match(agentScreen, /window\.scrollTo\(\{[\s\S]*document\.documentElement\.scrollHeight[\s\S]*document\.body\.scrollHeight[\s\S]*behavior: "auto"/);
  assert.match(agentScreen, /initialScrollPending\.current = false/);
});

test("plain Enter sends an Agent request while Shift+Enter keeps a newline", () => {
  assert.match(objectMentionInput, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(objectMentionInput, /event\.preventDefault\(\);\s*event\.currentTarget\.form\?\.requestSubmit\(\);/s);
});

test("the recorder uses the tuned microphone, live input meter, and elapsed-time presentation", () => {
  assert.match(app, /record-button/);
  assert.match(app, /className="record-microphone"/);
  assert.match(app, /className="record-meter"/);
  assert.match(app, /<span \/><span \/><span \/><span \/><span \/>/);
  assert.match(app, /createMediaStreamSource\(stream\)/);
  assert.match(app, /getByteTimeDomainData\(levelData\)/);
  assert.match(app, /formatRecordingClock\(recordingElapsedMs\)/);
  assert.match(styles, /\.record-button\.recording \{[^}]*background: #d83a20[^}]*animation: record-pulse/s);
  assert.match(styles, /\.record-button\.recording \.record-meter \{ display: flex; \}/);
});

test("recording takes over the composer and Cancel exits before voice upload", () => {
  const recorder = app.slice(app.indexOf("function AgentComposer("), app.indexOf("function AgentScreen("));
  assert.match(recorder, /audio: \{ echoCancellation: true, noiseSuppression: true, autoGainControl: true \}/);
  assert.match(recorder, /aria-label="Cancel recording"/);
  assert.match(recorder, /recordingCancelled\.current = true;[\s\S]+recorder\.current\.stop\(\)/);
  assert.ok(recorder.indexOf("if (recordingCancelled.current)") < recorder.indexOf('"\/api\/voice"'));
  assert.match(recorder, /setRecordingStatus\("Recording cancelled\."\)/);
  assert.match(styles, /\.composer\.recording \.composer-input-row \{[^}]*grid-template-areas: "cancel recorder send"/s);
  assert.match(styles, /\.composer\.recording \.composer-input-row textarea \{ display: none; \}/);
});

test("the recorder remains mounted through React Strict Mode effect replay", () => {
  assert.match(app, /useEffect\(\(\) => \{\s*mounted\.current = true;\s*return \(\) => \{\s*mounted\.current = false;/s);
});

test("request cards show live and persisted LLM and tool call metrics", () => {
  assert.match(types, /progress\?: RequestProgress \| null/);
  assert.match(types, /usage\?: RequestUsage \| null/);
  assert.match(app, /callCountLabel\(progress\.modelCalls, "LLM call"\)/);
  assert.match(app, /callCountLabel\(progress\.toolCalls, "tool call"\)/);
  assert.match(app, /request\.usage\?\.modelCallCount/);
  assert.match(app, /request\.usage\?\.toolCallCount/);
  assert.match(app, /<RequestInteractionMetrics request=\{request\} \/>/);
  assert.match(styles, /\.progress-spinner \{[^}]*animation: progress-spin/s);
  assert.match(styles, /\.interaction-metrics \{/);
});

test("request cards open the whole trace in collapsed sections with a copy action", () => {
  assert.match(app, />Show trace<\/button>/);
  assert.match(app, /\/api\/requests\/\$\{encodeURIComponent\(requestId\)\}\/trace/);
  assert.match(app, /<details className="trace-event"/);
  assert.doesNotMatch(app, /<details className="trace-event"[^>]*\sopen(?:=|\s|>)/);
  assert.match(app, />\{copyLabel\}<\/button>/);
  assert.match(app, /useState\("Copy trace"\)/);
  assert.match(app, /navigator\.clipboard\.writeText\(JSON\.stringify\(trace, null, 2\)\)/);
  assert.match(styles, /\.trace-panel \{/);
});

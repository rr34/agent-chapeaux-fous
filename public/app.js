const elements = {
  form: document.querySelector("#request-form"),
  text: document.querySelector("#request-text"),
  send: document.querySelector("#send"),
  record: document.querySelector("#record"),
  recordLabel: document.querySelector("#record-label"),
  recordTimer: document.querySelector("#record-timer"),
  status: document.querySelector("#composer-status"),
  runtime: document.querySelector("#runtime"),
  integration: document.querySelector("#integration"),
  usage: document.querySelector("#usage"),
  refresh: document.querySelector("#refresh"),
  list: document.querySelector("#request-list"),
  empty: document.querySelector("#empty"),
  template: document.querySelector("#request-template"),
  tracePanel: document.querySelector("#trace-panel"),
  traceHeading: document.querySelector("#trace-heading"),
  traceEvents: document.querySelector("#trace-events"),
  copyTrace: document.querySelector("#copy-trace"),
  closeTrace: document.querySelector("#close-trace"),
  tokenDialog: document.querySelector("#token-dialog"),
  tokenForm: document.querySelector("#token-form"),
  token: document.querySelector("#token"),
};

let accessToken = localStorage.getItem("agent-slayer-token") || "";
let lastHealth = null;
let activeTrace = null;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = null;
let recordingTimer = null;
const requestNodes = new Map();

function authHeaders(extra = {}) {
  return { ...extra, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options, headers: authHeaders(options.headers) });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (response.status === 401) {
    elements.tokenDialog.showModal();
    throw new Error("Access token required");
  }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function copyText(text, button = null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  if (button) {
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original; }, 1200);
  }
}

function formatTime(milliseconds) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(milliseconds));
}

function formatClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatDuration(milliseconds) {
  const seconds = Number(milliseconds) / 1000;
  if (!Number.isFinite(seconds)) return "—";
  return `${Math.max(.1, seconds).toFixed(1)} s`;
}

function progressDetail(progress) {
  if (!progress) return "";
  const elapsedMs = Math.max(0, Date.now() - Number(progress.startedAtMs || Date.now()));
  const quietMs = Math.max(0, Date.now() - Number(progress.lastActivityAtMs || progress.startedAtMs || Date.now()));
  const parts = [`${formatDuration(elapsedMs)} elapsed`];
  if (progress.modelCalls) parts.push(`${progress.modelCalls} model call${progress.modelCalls === 1 ? "" : "s"}`);
  if (progress.toolCalls) parts.push(`${progress.toolCalls} tool call${progress.toolCalls === 1 ? "" : "s"}`);
  if (elapsedMs >= 120_000) parts.unshift("Still working");
  if (quietMs >= 60_000) parts.push(`${formatDuration(quietMs)} since last activity`);
  return parts.join(" · ");
}

function updateProgressClocks() {
  for (const progress of document.querySelectorAll(".request-progress[data-progress]")) {
    try {
      progress.querySelector(".progress-detail").textContent = progressDetail(JSON.parse(progress.dataset.progress));
    } catch {
      // The next request poll replaces malformed progress state.
    }
  }
}

function usageWindows(usage) {
  return (usage?.buckets ?? []).flatMap((bucket) => ["primary", "secondary"].flatMap((kind) => {
    const window = bucket[kind];
    return window ? [{ ...window, bucketId: bucket.id, bucketName: bucket.name, kind }] : [];
  }));
}

function resetLabel(timestamp) {
  if (!timestamp) return "reset unknown";
  const milliseconds = Math.max(0, timestamp * 1000 - Date.now());
  const minutes = Math.ceil(milliseconds / 60000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `resets in ${hours}h ${remainder}m`;
}

function healthUsageLabel(model) {
  const name = model?.displayName || "Model";
  const windows = usageWindows(model?.usage).filter((window) => Number.isFinite(window.remainingPercent));
  if (!windows.length) return `${name} usage unavailable`;
  const limiting = windows.toSorted((left, right) => left.remainingPercent - right.remainingPercent)[0];
  return `${name} ${limiting.remainingPercent}% left · ${resetLabel(limiting.resetsAt)}`;
}

function requestUsageLabel(usage) {
  if (!usage) return "";
  const deltas = (usage.windows ?? []).map((window) => window.usedPercentDelta).filter(Number.isFinite);
  const largestDelta = deltas.length ? Math.max(...deltas) : null;
  const tokens = usage.tokenUsage?.totalTokens;
  const parts = [];
  if (largestDelta == null) parts.push("quota update pending");
  else if (largestDelta === 0) parts.push("quota change <1%");
  else parts.push(`+${largestDelta}% quota`);
  if (Number.isFinite(tokens)) parts.push(`${tokens.toLocaleString()} tokens`);
  const remaining = (usage.windows ?? []).map((window) => window.remainingPercent).filter(Number.isFinite);
  if (remaining.length) parts.push(`${Math.min(...remaining)}% left`);
  return parts.join(" · ");
}

function selectionTouchesRequests() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return elements.list.contains(range.commonAncestorContainer) || range.intersectsNode(elements.list);
}

function requestNode(request, index) {
  let node = requestNodes.get(request.requestId);
  if (!node) {
    node = elements.template.content.firstElementChild.cloneNode(true);
    node.dataset.requestId = request.requestId;
    node.querySelector(".copy-response").addEventListener("click", (event) => {
      copyText(node.querySelector(".agent-response p").textContent, event.currentTarget);
    });
    node.querySelector(".show-trace").addEventListener("click", () => showTrace(request.requestId));
    requestNodes.set(request.requestId, node);
  }
  node.dataset.status = request.status;
  node.querySelector(".request-number").textContent = `Request ${request.requestId.slice(0, 8)}`;
  node.querySelector(".request-channel").textContent = request.channel === "voice" ? "Voice" : "Typed";
  node.querySelector(".request-status").textContent = request.status;
  const time = node.querySelector("time");
  time.dateTime = new Date(request.submittedAtMs).toISOString();
  time.textContent = formatTime(request.submittedAtMs);
  node.querySelector(".user-request").textContent = request.request;
  const response = node.querySelector(".agent-response");
  response.hidden = !request.response;
  if (request.response) response.querySelector("p").textContent = request.response;
  const error = node.querySelector(".request-error");
  error.hidden = !request.error;
  error.textContent = request.error || "";
  const usage = node.querySelector(".request-usage");
  usage.textContent = requestUsageLabel(request.usage);
  usage.hidden = !usage.textContent;
  const progress = node.querySelector(".request-progress");
  progress.hidden = !request.progress;
  if (request.progress) {
    progress.dataset.progress = JSON.stringify(request.progress);
    progress.querySelector(".progress-label").textContent = request.progress.label;
    progress.querySelector(".progress-detail").textContent = progressDetail(request.progress);
  } else {
    delete progress.dataset.progress;
  }
  node.style.order = index;
  return node;
}

async function loadRequests({ force = false } = {}) {
  if (!force && selectionTouchesRequests()) return;
  const body = await api("/api/requests?limit=100");
  const seen = new Set();
  body.requests.forEach((request, index) => {
    seen.add(request.requestId);
    const node = requestNode(request, index);
    if (!node.isConnected) elements.list.append(node);
  });
  for (const [id, node] of requestNodes) {
    if (!seen.has(id)) { node.remove(); requestNodes.delete(id); }
  }
  elements.empty.hidden = body.requests.length > 0;
}

function traceLabel(event, index) {
  const labels = {
    "request.received": "USER REQUEST",
    "context.sent": "CONTEXT SENT",
    "tools.sent": "TOOLS SENT",
    "model.request": "MODEL REQUEST",
    "model.response": "MODEL RESPONSE",
    "model.usage": "MODEL USAGE",
    "tool.call": "TOOL CALL",
    "tool.result": "TOOL RESULT",
    "assistant.response": "FINAL RESPONSE",
  };
  return `${index + 1}. ${labels[event.type] || event.type.toUpperCase()} · ${event.status || event.phase}`;
}

async function showTrace(requestId) {
  const body = await api(`/api/requests/${requestId}/trace`);
  activeTrace = body;
  elements.traceHeading.textContent = `Trace ${requestId.slice(0, 8)}`;
  elements.traceEvents.replaceChildren();
  body.events.forEach((event, index) => {
    const details = document.createElement("details");
    details.className = "trace-event";
    if (["request.received", "context.sent", "tools.sent", "model.request", "tool.call", "tool.result", "assistant.response", "request.error"].includes(event.type)) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = traceLabel(event, index);
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(event, null, 2);
    details.append(summary, pre);
    elements.traceEvents.append(details);
  });
  elements.tracePanel.hidden = false;
  elements.tracePanel.scrollTop = 0;
}

async function loadHealth() {
  const response = await fetch("/health", { cache: "no-store" });
  let body;
  try { body = await response.json(); } catch { body = { ready: false, error: `Invalid health response (${response.status})` }; }
  lastHealth = { checkedAtUtc: new Date().toISOString(), httpStatus: response.status, body };
  const commit = body.runtime?.commit || "uncommitted";
  elements.runtime.textContent = `${commit}${body.runtime?.dirty ? "-dirty" : ""}`;
  elements.runtime.classList.toggle("ready", Boolean(body.ready));
  elements.runtime.classList.toggle("not-ready", !body.ready);
  elements.runtime.title = `${body.ready ? "Ready" : "Not ready"}. Click to copy full health diagnostics.`;
  elements.usage.textContent = healthUsageLabel(body.model);
  elements.usage.classList.toggle("ready", Boolean(body.model?.usage));
  elements.usage.classList.toggle("not-ready", !body.model?.usage);
  const oauthEntry = Object.entries(body.integrations ?? {}).find(([, integration]) => integration.oauth);
  elements.integration.hidden = !oauthEntry;
  if (oauthEntry) {
    const [name, integration] = oauthEntry;
    elements.integration.dataset.name = name;
    elements.integration.disabled = Boolean(integration.ready);
    elements.integration.classList.toggle("ready", Boolean(integration.ready));
    elements.integration.classList.toggle("not-ready", !integration.ready);
    elements.integration.textContent = integration.ready
      ? `${name.toUpperCase()} connected`
      : `Connect ${name.toUpperCase()}`;
    elements.integration.title = integration.ready
      ? `${name} MCP OAuth is connected.`
      : `Authorize Agent Slayer to use ${name}.`;
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.text.value.trim();
  if (!text) return;
  elements.send.disabled = true;
  elements.status.textContent = "Submitting…";
  try {
    await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    elements.text.value = "";
    elements.status.textContent = "Queued.";
    await loadRequests({ force: true });
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.send.disabled = false;
  }
});

elements.record.addEventListener("click", async () => {
  if (recorder?.state === "recording") {
    clearInterval(recordingTimer);
    recorder.stop();
    elements.record.disabled = true;
    elements.record.classList.remove("recording");
    elements.record.setAttribute("aria-label", "Saving recording");
    elements.recordLabel.textContent = "Saving recording…";
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    recordingChunks = [];
    recorder = new MediaRecorder(recordingStream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", async () => {
      recordingStream?.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      elements.status.textContent = "Uploading voice request…";
      try {
        await api("/api/voice", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        elements.status.textContent = "Voice request queued.";
        await loadRequests({ force: true });
      } catch (error) {
        elements.status.textContent = error.message;
      } finally {
        recorder = null;
        recordingStream = null;
        recordingStartedAt = null;
        elements.record.disabled = false;
        elements.record.classList.remove("recording");
        elements.record.setAttribute("aria-label", "Start recording");
        elements.recordLabel.textContent = "Tap to record";
        elements.recordTimer.textContent = "00:00";
      }
    });
    recorder.start(1000);
    recordingStartedAt = Date.now();
    elements.record.classList.add("recording");
    elements.record.setAttribute("aria-label", "Stop and queue recording");
    elements.recordLabel.textContent = "Tap to queue";
    elements.recordTimer.textContent = "00:00";
    recordingTimer = setInterval(() => {
      elements.recordTimer.textContent = formatClock(Date.now() - recordingStartedAt);
    }, 250);
    elements.status.textContent = "Recording…";
  } catch (error) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    recorder = null;
    elements.record.classList.remove("recording");
    elements.recordLabel.textContent = "Tap to record";
    elements.recordTimer.textContent = "00:00";
    elements.status.textContent = error.message;
  }
});

elements.refresh.addEventListener("click", () => loadRequests({ force: true }).catch((error) => { elements.status.textContent = error.message; }));
elements.integration.addEventListener("click", async () => {
  const name = elements.integration.dataset.name;
  if (!name) return;
  elements.integration.disabled = true;
  elements.status.textContent = `Starting ${name.toUpperCase()} authorization…`;
  try {
    const result = await api(`/api/integrations/${encodeURIComponent(name)}/oauth/start`, { method: "POST" });
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    elements.status.textContent = error.message;
    elements.integration.disabled = false;
  }
});
elements.runtime.addEventListener("click", (event) => copyText(JSON.stringify(lastHealth, null, 2), event.currentTarget));
elements.usage.addEventListener("click", (event) => copyText(JSON.stringify(lastHealth?.body?.model?.usage ?? null, null, 2), event.currentTarget));
elements.closeTrace.addEventListener("click", () => { elements.tracePanel.hidden = true; });
elements.copyTrace.addEventListener("click", (event) => copyText(JSON.stringify(activeTrace, null, 2), event.currentTarget));
elements.tokenForm.addEventListener("submit", () => {
  accessToken = elements.token.value.trim();
  localStorage.setItem("agent-slayer-token", accessToken);
  setTimeout(() => Promise.allSettled([loadHealth(), loadRequests({ force: true })]), 0);
});

if (!accessToken) elements.tokenDialog.showModal();
if (new URLSearchParams(window.location.search).get("oauth") === "connected") {
  elements.status.textContent = "MCP OAuth connected.";
  history.replaceState(null, "", window.location.pathname);
}
loadHealth().catch(() => {});
loadRequests({ force: true }).catch(() => {});
setInterval(() => loadHealth().catch(() => {}), 5000);
setInterval(() => loadRequests().catch(() => {}), 1500);
setInterval(updateProgressClocks, 250);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});

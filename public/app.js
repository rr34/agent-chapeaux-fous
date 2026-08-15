const elements = {
  form: document.querySelector("#request-form"),
  text: document.querySelector("#request-text"),
  send: document.querySelector("#send"),
  record: document.querySelector("#record"),
  status: document.querySelector("#composer-status"),
  runtime: document.querySelector("#runtime"),
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
let recordingChunks = [];
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
    recorder.stop();
    elements.record.textContent = "Record voice";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      elements.status.textContent = "Uploading voice request…";
      try {
        await api("/api/voice", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        elements.status.textContent = "Voice request queued.";
        await loadRequests({ force: true });
      } catch (error) { elements.status.textContent = error.message; }
    });
    recorder.start();
    elements.record.textContent = "Stop recording";
    elements.status.textContent = "Recording…";
  } catch (error) { elements.status.textContent = error.message; }
});

elements.refresh.addEventListener("click", () => loadRequests({ force: true }).catch((error) => { elements.status.textContent = error.message; }));
elements.runtime.addEventListener("click", (event) => copyText(JSON.stringify(lastHealth, null, 2), event.currentTarget));
elements.closeTrace.addEventListener("click", () => { elements.tracePanel.hidden = true; });
elements.copyTrace.addEventListener("click", (event) => copyText(JSON.stringify(activeTrace, null, 2), event.currentTarget));
elements.tokenForm.addEventListener("submit", () => {
  accessToken = elements.token.value.trim();
  localStorage.setItem("agent-slayer-token", accessToken);
  setTimeout(() => Promise.allSettled([loadHealth(), loadRequests({ force: true })]), 0);
});

if (!accessToken) elements.tokenDialog.showModal();
loadHealth().catch(() => {});
loadRequests({ force: true }).catch(() => {});
setInterval(() => loadHealth().catch(() => {}), 5000);
setInterval(() => loadRequests().catch(() => {}), 1500);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});

const elements = {
  form: document.querySelector("#request-form"),
  text: document.querySelector("#request-text"),
  send: document.querySelector("#send"),
  record: document.querySelector("#record"),
  recordLabel: document.querySelector("#record-label"),
  recordTimer: document.querySelector("#record-timer"),
  status: document.querySelector("#composer-status"),
  runtime: document.querySelector("#runtime"),
  integrationsButton: document.querySelector("#integrations-button"),
  integrationsDialog: document.querySelector("#integrations-dialog"),
  integrationList: document.querySelector("#integration-list"),
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
  navButtons: [...document.querySelectorAll(".nav-button")],
  agentView: document.querySelector("#agent-view"),
  calendarView: document.querySelector("#calendar-view"),
  todosView: document.querySelector("#todos-view"),
  logsView: document.querySelector("#logs-view"),
  calendarMonthLabel: document.querySelector("#calendar-month-label"),
  calendarTimeZone: document.querySelector("#calendar-time-zone"),
  calendarGrid: document.querySelector("#calendar-grid"),
  calendarScheduleMode: document.querySelector("#calendar-schedule-mode"),
  calendarScheduleTask: document.querySelector("#calendar-schedule-task"),
  calendarScheduleHint: document.querySelector("#calendar-schedule-hint"),
  cancelCalendarSchedule: document.querySelector("#cancel-calendar-schedule"),
  agendaDate: document.querySelector("#agenda-date"),
  agendaList: document.querySelector("#agenda-list"),
  previousMonth: document.querySelector("#previous-month"),
  today: document.querySelector("#today"),
  nextMonth: document.querySelector("#next-month"),
  newEvent: document.querySelector("#new-event"),
  eventDialog: document.querySelector("#event-dialog"),
  eventForm: document.querySelector("#event-form"),
  eventDialogTitle: document.querySelector("#event-dialog-title"),
  eventId: document.querySelector("#event-id"),
  eventVersion: document.querySelector("#event-version"),
  eventTitle: document.querySelector("#event-title"),
  eventAllDay: document.querySelector("#event-all-day"),
  eventStart: document.querySelector("#event-start"),
  eventEnd: document.querySelector("#event-end"),
  eventLocation: document.querySelector("#event-location"),
  eventDescription: document.querySelector("#event-description"),
  eventStatus: document.querySelector("#event-status"),
  eventRepeatEnabled: document.querySelector("#event-repeat-enabled"),
  eventRepeatFields: document.querySelector("#event-repeat-fields"),
  eventRepeatInterval: document.querySelector("#event-repeat-interval"),
  eventRepeatFrequency: document.querySelector("#event-repeat-frequency"),
  eventRepeatWeekdays: document.querySelector("#event-repeat-weekdays"),
  eventRepeatEnd: document.querySelector("#event-repeat-end"),
  eventRepeatCountLabel: document.querySelector("#event-repeat-count-label"),
  eventRepeatCount: document.querySelector("#event-repeat-count"),
  eventRepeatUntilLabel: document.querySelector("#event-repeat-until-label"),
  eventRepeatUntil: document.querySelector("#event-repeat-until"),
  eventRepeatSummary: document.querySelector("#event-repeat-summary"),
  eventFormError: document.querySelector("#event-form-error"),
  todoScope: document.querySelector("#todo-scope"),
  todoGroupFilter: document.querySelector("#todo-group-filter"),
  todoCount: document.querySelector("#todo-count"),
  todoList: document.querySelector("#todo-list"),
  newTodo: document.querySelector("#new-todo"),
  newTodoGroup: document.querySelector("#new-todo-group"),
  todoDialog: document.querySelector("#todo-dialog"),
  todoForm: document.querySelector("#todo-form"),
  todoDialogTitle: document.querySelector("#todo-dialog-title"),
  todoId: document.querySelector("#todo-id"),
  todoVersion: document.querySelector("#todo-version"),
  todoText: document.querySelector("#todo-text"),
  todoGroup: document.querySelector("#todo-group"),
  todoNewGroup: document.querySelector("#todo-new-group"),
  todoSequence: document.querySelector("#todo-sequence"),
  todoScheduled: document.querySelector("#todo-scheduled"),
  todoAllDay: document.querySelector("#todo-all-day"),
  todoDue: document.querySelector("#todo-due"),
  todoStatus: document.querySelector("#todo-status"),
  todoRepeatEnabled: document.querySelector("#todo-repeat-enabled"),
  todoRepeatFields: document.querySelector("#todo-repeat-fields"),
  todoRepeatInterval: document.querySelector("#todo-repeat-interval"),
  todoRepeatFrequency: document.querySelector("#todo-repeat-frequency"),
  todoRepeatWeekdays: document.querySelector("#todo-repeat-weekdays"),
  todoRepeatEnd: document.querySelector("#todo-repeat-end"),
  todoRepeatCountLabel: document.querySelector("#todo-repeat-count-label"),
  todoRepeatCount: document.querySelector("#todo-repeat-count"),
  todoRepeatUntilLabel: document.querySelector("#todo-repeat-until-label"),
  todoRepeatUntil: document.querySelector("#todo-repeat-until"),
  todoRepeatSummary: document.querySelector("#todo-repeat-summary"),
  todoFormError: document.querySelector("#todo-form-error"),
  logGroupFilter: document.querySelector("#log-group-filter"),
  logTrackerFilter: document.querySelector("#log-tracker-filter"),
  logCount: document.querySelector("#log-count"),
  logList: document.querySelector("#log-list"),
  newLogEntry: document.querySelector("#new-log-entry"),
  logDialog: document.querySelector("#log-dialog"),
  logForm: document.querySelector("#log-form"),
  logTracker: document.querySelector("#log-tracker"),
  newLogTrackerFields: document.querySelector("#new-log-tracker-fields"),
  logTrackerName: document.querySelector("#log-tracker-name"),
  logGroupName: document.querySelector("#log-group-name"),
  logGroupOptions: document.querySelector("#log-group-options"),
  logContent: document.querySelector("#log-content"),
  logNumber: document.querySelector("#log-number"),
  logUnit: document.querySelector("#log-unit"),
  logOccurred: document.querySelector("#log-occurred"),
  logFormError: document.querySelector("#log-form-error"),
};

let accessToken = localStorage.getItem("agent-slayer-token") || "";
let lastHealth = null;
let activeTrace = null;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = null;
let recordingTimer = null;
let activeView = "agent";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = new Date();
let calendarEvents = [];
let activeTodos = [];
let calendarSchedulingTodo = null;
let calendarSchedulingBusy = false;
let displayedTodos = [];
let todoGroups = [];
let loadedTodoRecurrenceTimeZone = null;
let todoRecurrenceDirty = false;
let logTrackers = [];
let logEntries = [];
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

function node(tag, className = "", textContent = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent !== "") element.textContent = textContent;
  return element;
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

function formatDisplayDate(value, { includeTime = true, fallback = "—" } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).formatToParts(date);
  const part = (type) => dateParts.find((candidate) => candidate.type === type)?.value ?? "";
  const dateLabel = `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
  if (!includeTime) return dateLabel;
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const timePart = (type) => timeParts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${dateLabel} at ${timePart("hour")}:${timePart("minute")}`;
}

const recurrenceWeekdays = [
  ["MO", "Mon"], ["TU", "Tue"], ["WE", "Wed"], ["TH", "Thu"],
  ["FR", "Fri"], ["SA", "Sat"], ["SU", "Sun"],
];
const recurrenceFrequencyLabels = {
  DAILY: ["day", "days"], WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"], YEARLY: ["year", "years"],
};

function recurrenceParts(rule) {
  const values = {};
  for (const segment of String(rule || "").replace(/^RRULE:/i, "").split(";")) {
    const separator = segment.indexOf("=");
    if (separator > 0) values[segment.slice(0, separator).toUpperCase()] = segment.slice(separator + 1);
  }
  return values;
}

function selectedRepeatWeekdays() {
  return [...elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]:checked')]
    .map(({ value }) => value);
}

function repeatAnchorWeekday(value) {
  const date = value
    ? new Date(value.includes("T") ? value : `${value}T12:00:00`)
    : new Date();
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()];
}

function scheduledWeekday() {
  return repeatAnchorWeekday(elements.todoScheduled.value);
}

function ensureRepeatWeekday() {
  if (elements.todoRepeatFrequency.value !== "WEEKLY" || selectedRepeatWeekdays().length) return;
  const fallback = scheduledWeekday();
  const checkbox = elements.todoRepeatWeekdays.querySelector(`input[value="${fallback}"]`);
  if (checkbox) checkbox.checked = true;
}

function buildTodoRecurrenceRule() {
  if (!elements.todoRepeatEnabled.checked) return null;
  const interval = Number(elements.todoRepeatInterval.value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new Error("Repeat interval must be a whole number from 1 to 999.");
  }
  const frequency = elements.todoRepeatFrequency.value;
  const parts = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
  if (frequency === "WEEKLY") {
    ensureRepeatWeekday();
    const weekdays = selectedRepeatWeekdays();
    if (!weekdays.length) throw new Error("Choose at least one weekday.");
    parts.push(`BYDAY=${weekdays.join(",")}`);
  }
  if (elements.todoRepeatEnd.value === "count") {
    const count = Number(elements.todoRepeatCount.value);
    if (!Number.isInteger(count) || count < 1 || count > 9999) {
      throw new Error("Occurrences must be a whole number from 1 to 9999.");
    }
    parts.push(`COUNT=${count}`);
  } else if (elements.todoRepeatEnd.value === "until") {
    const until = elements.todoRepeatUntil.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose the last recurrence date.");
    parts.push(`UNTIL=${until.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

function describeTodoRecurrence(rule) {
  if (!rule) return "Does not repeat";
  const parts = recurrenceParts(rule);
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const labels = recurrenceFrequencyLabels[parts.FREQ] || ["period", "periods"];
  let description = interval === 1 ? `Every ${labels[0]}` : `Every ${interval} ${labels[1]}`;
  if (parts.FREQ === "WEEKLY" && parts.BYDAY) {
    const labelsByValue = Object.fromEntries(recurrenceWeekdays);
    const days = parts.BYDAY.split(",").map((day) => labelsByValue[day] || day);
    description += ` on ${days.join(", ")}`;
  }
  if (parts.COUNT) description += `, ${parts.COUNT} occurrences`;
  if (parts.UNTIL) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (match) description += `, through ${formatDisplayDate(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`), { includeTime: false })}`;
  }
  return description;
}

function updateTodoRecurrenceEditor() {
  const enabled = elements.todoRepeatEnabled.checked;
  elements.todoRepeatFields.hidden = !enabled;
  if (!enabled) return;
  const weekly = elements.todoRepeatFrequency.value === "WEEKLY";
  elements.todoRepeatWeekdays.hidden = !weekly;
  if (weekly) ensureRepeatWeekday();
  const ending = elements.todoRepeatEnd.value;
  elements.todoRepeatCountLabel.hidden = ending !== "count";
  elements.todoRepeatUntilLabel.hidden = ending !== "until";
  try {
    elements.todoRepeatSummary.textContent = describeTodoRecurrence(buildTodoRecurrenceRule());
  } catch (error) {
    elements.todoRepeatSummary.textContent = error.message;
  }
}

function loadTodoRecurrenceEditor(rule, recurrenceTimeZone = null) {
  loadedTodoRecurrenceTimeZone = recurrenceTimeZone || null;
  todoRecurrenceDirty = false;
  const parts = recurrenceParts(rule);
  elements.todoRepeatEnabled.checked = Boolean(rule);
  elements.todoRepeatFrequency.value = recurrenceFrequencyLabels[parts.FREQ] ? parts.FREQ : "WEEKLY";
  elements.todoRepeatInterval.value = String(Math.max(1, Number(parts.INTERVAL) || 1));
  for (const checkbox of elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = (parts.BYDAY || "").split(",").includes(checkbox.value);
  }
  elements.todoRepeatEnd.value = parts.COUNT ? "count" : parts.UNTIL ? "until" : "never";
  elements.todoRepeatCount.value = parts.COUNT || "10";
  const untilMatch = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  elements.todoRepeatUntil.value = untilMatch ? `${untilMatch[1]}-${untilMatch[2]}-${untilMatch[3]}` : "";
  updateTodoRecurrenceEditor();
}

function selectedEventRepeatWeekdays() {
  return [...elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]:checked')]
    .map(({ value }) => value);
}

function ensureEventRepeatWeekday() {
  if (elements.eventRepeatFrequency.value !== "WEEKLY" || selectedEventRepeatWeekdays().length) return;
  const weekday = repeatAnchorWeekday(elements.eventStart.value);
  const checkbox = elements.eventRepeatWeekdays.querySelector(`input[value="${weekday}"]`);
  if (checkbox) checkbox.checked = true;
}

function buildEventRecurrenceRule() {
  if (!elements.eventRepeatEnabled.checked) return null;
  const interval = Number(elements.eventRepeatInterval.value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new Error("Repeat interval must be a whole number from 1 to 999.");
  }
  const frequency = elements.eventRepeatFrequency.value;
  const parts = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
  if (frequency === "WEEKLY") {
    ensureEventRepeatWeekday();
    const weekdays = selectedEventRepeatWeekdays();
    if (!weekdays.length) throw new Error("Choose at least one weekday.");
    parts.push(`BYDAY=${weekdays.join(",")}`);
  }
  if (elements.eventRepeatEnd.value === "count") {
    const count = Number(elements.eventRepeatCount.value);
    if (!Number.isInteger(count) || count < 1 || count > 9999) {
      throw new Error("Occurrences must be a whole number from 1 to 9999.");
    }
    parts.push(`COUNT=${count}`);
  } else if (elements.eventRepeatEnd.value === "until") {
    const until = elements.eventRepeatUntil.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose the last recurrence date.");
    parts.push(`UNTIL=${until.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

function updateEventRecurrenceEditor() {
  const enabled = elements.eventRepeatEnabled.checked;
  elements.eventRepeatFields.hidden = !enabled;
  if (!enabled) return;
  const weekly = elements.eventRepeatFrequency.value === "WEEKLY";
  elements.eventRepeatWeekdays.hidden = !weekly;
  if (weekly) ensureEventRepeatWeekday();
  const ending = elements.eventRepeatEnd.value;
  elements.eventRepeatCountLabel.hidden = ending !== "count";
  elements.eventRepeatUntilLabel.hidden = ending !== "until";
  try {
    elements.eventRepeatSummary.textContent = describeTodoRecurrence(buildEventRecurrenceRule());
  } catch (error) {
    elements.eventRepeatSummary.textContent = error.message;
  }
}

function loadEventRecurrenceEditor(rule) {
  const parts = recurrenceParts(rule);
  elements.eventRepeatEnabled.checked = Boolean(rule);
  elements.eventRepeatFrequency.value = recurrenceFrequencyLabels[parts.FREQ] ? parts.FREQ : "WEEKLY";
  elements.eventRepeatInterval.value = String(Math.max(1, Number(parts.INTERVAL) || 1));
  for (const checkbox of elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = (parts.BYDAY || "").split(",").includes(checkbox.value);
  }
  elements.eventRepeatEnd.value = parts.COUNT ? "count" : parts.UNTIL ? "until" : "never";
  elements.eventRepeatCount.value = parts.COUNT || "10";
  const untilMatch = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  elements.eventRepeatUntil.value = untilMatch ? `${untilMatch[1]}-${untilMatch[2]}-${untilMatch[3]}` : "";
  updateEventRecurrenceEditor();
}

function formatTime(milliseconds) {
  return formatDisplayDate(milliseconds);
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
  const elapsed = node.querySelector(".request-elapsed");
  elapsed.textContent = Number.isFinite(request.elapsedMs) ? `${formatDuration(request.elapsedMs)} elapsed` : "";
  elapsed.hidden = !elapsed.textContent;
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
  renderIntegrations(body.integrations ?? {});
}

function renderIntegrations(integrations) {
  const oauthEntries = Object.entries(integrations).filter(([, integration]) => integration.oauth);
  const connected = oauthEntries.filter(([, integration]) => integration.ready).length;
  elements.integrationsButton.textContent = connected ? `Integrations · ${connected}` : "Integrations";
  elements.integrationsButton.classList.toggle("ready", connected > 0);
  elements.integrationList.replaceChildren();
  if (oauthEntries.length === 0) {
    elements.integrationList.append(node("p", "empty", "No OAuth integrations are configured."));
    return;
  }
  for (const [name, integration] of oauthEntries) {
    const card = node("article", "integration-card");
    const identity = node("div", "integration-identity");
    identity.append(
      node("strong", "", name),
      node("span", "", integration.disabled ? "Disabled" : integration.ready ? "Connected" : "Disconnected"),
    );
    card.classList.toggle("ready", Boolean(integration.ready));
    card.append(identity);
    if (!integration.disabled) {
      const action = node("button", integration.ready ? "secondary compact disconnect-integration" : "compact connect-integration");
      action.type = "button";
      action.dataset.name = name;
      action.textContent = integration.ready ? "Disconnect" : "Connect";
      card.append(action);
    }
    elements.integrationList.append(card);
  }
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function localDateTimeInput(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function inputToIso(value, allDay = false) {
  if (!value) return null;
  const date = new Date(allDay && !value.includes("T") ? `${value}T00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthGridRange(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  const gridEnd = addDays(last, 7 - ((last.getDay() + 6) % 7));
  return { first, gridStart, gridEnd };
}

function occursOnDay(calendarEvent, day) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const start = new Date(calendarEvent.startsAtUtc).getTime();
  const end = calendarEvent.endsAtUtc ? new Date(calendarEvent.endsAtUtc).getTime() : start;
  return start < dayEnd && (end > dayStart || (start >= dayStart && start < dayEnd));
}

function todosDueOnDay(day) {
  const key = localDateKey(day);
  return activeTodos.filter((todo) => todo.dueAtUtc && localDateKey(todo.dueAtUtc) === key);
}

function todosScheduledOnDay(day) {
  const key = localDateKey(day);
  return activeTodos.filter((todo) => todo.scheduledAtUtc && localDateKey(todo.scheduledAtUtc) === key);
}

function formatEventTime(calendarEvent) {
  if (calendarEvent.isAllDay) return "All day";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
  });
  const start = formatter.format(new Date(calendarEvent.startsAtUtc));
  return calendarEvent.endsAtUtc
    ? `${start}–${formatter.format(new Date(calendarEvent.endsAtUtc))}`
    : start;
}

function switchView(view) {
  if (view !== "calendar" && calendarSchedulingTodo) cancelCalendarScheduling({ render: false });
  activeView = view;
  elements.agentView.hidden = view !== "agent";
  elements.calendarView.hidden = view !== "calendar";
  elements.todosView.hidden = view !== "todos";
  elements.logsView.hidden = view !== "logs";
  for (const button of elements.navButtons) button.classList.toggle("active", button.dataset.view === view);
  if (view === "calendar") void refreshCalendar();
  if (view === "todos") void refreshTodos();
  if (view === "logs") void refreshLogs();
}

async function refreshCalendar() {
  const { gridStart, gridEnd } = monthGridRange(calendarCursor);
  try {
    const [calendarBody, todoBody, groupBody] = await Promise.all([
      api(`/api/calendar-events?from=${encodeURIComponent(gridStart.toISOString())}&to=${encodeURIComponent(gridEnd.toISOString())}`),
      api("/api/todos?scope=active&limit=1000"),
      api("/api/todo-groups"),
    ]);
    calendarEvents = calendarBody.events;
    activeTodos = todoBody.todos;
    todoGroups = groupBody.groups;
    if (calendarSchedulingTodo) {
      calendarSchedulingTodo = activeTodos.find(({ id }) => id === calendarSchedulingTodo.id) ?? null;
      updateCalendarSchedulingMode();
    }
    renderCalendar();
  } catch (error) {
    elements.calendarGrid.replaceChildren(node("p", "empty", error.message || "Calendar unavailable."));
  }
}

function renderCalendar() {
  const { first, gridStart, gridEnd } = monthGridRange(calendarCursor);
  elements.calendarMonthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first);
  elements.calendarTimeZone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
  elements.calendarGrid.replaceChildren();
  const todayKey = localDateKey(new Date());
  const selectedKey = localDateKey(selectedCalendarDate);
  for (let day = new Date(gridStart); day < gridEnd; day = addDays(day, 1)) {
    const date = new Date(day);
    const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, date));
    const scheduled = todosScheduledOnDay(date);
    const due = todosDueOnDay(date);
    const button = node("button", "calendar-day");
    button.type = "button";
    button.classList.toggle("outside", date.getMonth() !== calendarCursor.getMonth());
    button.classList.toggle("today", localDateKey(date) === todayKey);
    button.classList.toggle("selected", localDateKey(date) === selectedKey);
    button.setAttribute("aria-label", formatDisplayDate(date, { includeTime: false }));
    button.append(node("span", "day-number", String(date.getDate())));
    const items = node("span", "day-items");
    const visible = [
      ...events.map((value) => ({ type: "event", value })),
      ...scheduled.map((value) => ({ type: "todo", value, marker: value.isAllDay ? "All day" : "◷" })),
      ...due.map((value) => ({ type: "todo", value, marker: "Due" })),
    ];
    for (const item of visible.slice(0, 3)) {
      items.append(item.type === "event"
        ? node("span", `day-event ${item.value.status}`, `${item.value.isAllDay ? "" : `${formatEventTime(item.value)} `}${item.value.title}`)
        : node("span", "day-todo", `${item.marker} ${item.value.text}`));
    }
    if (visible.length > 3) items.append(node("span", "day-more", `+${visible.length - 3} more`));
    button.append(items);
    button.disabled = calendarSchedulingBusy;
    button.addEventListener("click", () => {
      if (calendarSchedulingTodo) void scheduleTodoOnDate(date);
      else {
        selectedCalendarDate = date;
        renderCalendar();
      }
    });
    elements.calendarGrid.append(button);
  }
  renderAgenda();
}

function scheduledDateOnDay(_todo, date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function updateCalendarSchedulingMode() {
  const todo = calendarSchedulingTodo;
  elements.calendarView.classList.toggle("scheduling", Boolean(todo));
  elements.calendarScheduleMode.hidden = !todo;
  elements.cancelCalendarSchedule.disabled = calendarSchedulingBusy;
  if (!todo) return;
  elements.calendarScheduleTask.textContent = todo.text;
  elements.calendarScheduleHint.textContent = "Choose a day. This task will be scheduled for that whole day.";
}

function beginCalendarScheduling(todo) {
  calendarSchedulingTodo = todo;
  calendarSchedulingBusy = false;
  if (todo.scheduledAtUtc) {
    selectedCalendarDate = new Date(todo.scheduledAtUtc);
    calendarCursor = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
  } else {
    selectedCalendarDate = new Date();
    calendarCursor = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
  }
  updateCalendarSchedulingMode();
  switchView("calendar");
}

function cancelCalendarScheduling({ render = true } = {}) {
  calendarSchedulingTodo = null;
  calendarSchedulingBusy = false;
  updateCalendarSchedulingMode();
  if (render && activeView === "calendar") renderCalendar();
}

async function scheduleTodoOnDate(date) {
  if (!calendarSchedulingTodo || calendarSchedulingBusy) return;
  const todo = calendarSchedulingTodo;
  const scheduled = scheduledDateOnDay(todo, date);
  const payload = { version: todo.version, scheduledAtUtc: scheduled.toISOString(), isAllDay: true };
  if (todo.scheduledAtUtc && todo.dueAtUtc) {
    const previousScheduled = new Date(todo.scheduledAtUtc);
    const dayDifference = Math.round((
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      - Date.UTC(previousScheduled.getFullYear(), previousScheduled.getMonth(), previousScheduled.getDate())
    ) / 86_400_000);
    const movedDue = new Date(todo.dueAtUtc);
    movedDue.setDate(movedDue.getDate() + dayDifference);
    payload.dueAtUtc = movedDue.toISOString();
  }
  calendarSchedulingBusy = true;
  updateCalendarSchedulingMode();
  renderCalendar();
  try {
    await api(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    selectedCalendarDate = new Date(date);
    cancelCalendarScheduling({ render: false });
    await refreshCalendar();
  } catch (error) {
    calendarSchedulingBusy = false;
    updateCalendarSchedulingMode();
    renderCalendar();
    window.alert(error.message || "Could not schedule the task.");
  }
}

function renderAgenda() {
  const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, selectedCalendarDate));
  const todoEntries = [
    ...todosScheduledOnDay(selectedCalendarDate).map((todo) => ({
      todo, timing: todo.isAllDay ? "All-day task" : "Scheduled task",
    })),
    ...todosDueOnDay(selectedCalendarDate).map((todo) => ({ todo, timing: "Task due" })),
  ];
  elements.agendaDate.textContent = formatDisplayDate(selectedCalendarDate, { includeTime: false });
  elements.agendaList.replaceChildren();
  if (events.length === 0 && todoEntries.length === 0) {
    elements.agendaList.append(node("p", "agenda-empty", "Nothing scheduled. Add an event here or tell Slayer what to put on the calendar."));
    return;
  }
  for (const calendarEvent of events) {
    const button = node("button", "agenda-item");
    button.type = "button";
    button.append(
      node("strong", "", calendarEvent.title),
      node("span", "", [formatEventTime(calendarEvent), calendarEvent.location].filter(Boolean).join(" · ")),
    );
    if (calendarEvent.seriesId) {
      button.title = "Edit this recurring event series.";
      button.addEventListener("click", () => openEventEditor({
        ...calendarEvent,
        id: calendarEvent.seriesId,
        startsAtUtc: calendarEvent.seriesStartsAtUtc,
        endsAtUtc: calendarEvent.seriesEndsAtUtc,
        readOnly: false,
      }));
    } else if (calendarEvent.readOnly) {
      button.disabled = true;
      button.title = "This item is generated from a contact record.";
    } else {
      button.addEventListener("click", () => openEventEditor(calendarEvent));
    }
    elements.agendaList.append(button);
  }
  for (const { todo, timing } of todoEntries) {
    const button = node("button", "agenda-item todo");
    button.type = "button";
    button.append(node("strong", "", todo.text), node("span", "", `${timing} · ${todo.status.replaceAll("_", " ")}`));
    button.addEventListener("click", () => openTodoEditor(todo));
    elements.agendaList.append(button);
  }
}

function setEventInputTypes(allDay) {
  const oldStart = elements.eventStart.value;
  const oldEnd = elements.eventEnd.value;
  elements.eventStart.type = allDay ? "date" : "datetime-local";
  elements.eventEnd.type = allDay ? "date" : "datetime-local";
  if (allDay) {
    elements.eventStart.value = oldStart.slice(0, 10);
    elements.eventEnd.value = oldEnd.slice(0, 10);
  } else {
    elements.eventStart.value = oldStart ? `${oldStart.slice(0, 10)}T09:00` : "";
    elements.eventEnd.value = oldEnd ? `${oldEnd.slice(0, 10)}T10:00` : "";
  }
}

function setTodoScheduledInputType(allDay) {
  const previous = elements.todoScheduled.value;
  elements.todoScheduled.type = allDay ? "date" : "datetime-local";
  if (allDay) elements.todoScheduled.value = previous.slice(0, 10);
  else if (previous) elements.todoScheduled.value = `${previous.slice(0, 10)}T09:00`;
}

function openEventEditor(calendarEvent = null) {
  elements.eventForm.reset();
  elements.eventFormError.textContent = "";
  elements.eventDialogTitle.textContent = calendarEvent ? "Edit event" : "New event";
  elements.eventId.value = calendarEvent?.id ?? "";
  elements.eventVersion.value = calendarEvent?.version ?? "";
  elements.eventTitle.value = calendarEvent?.title ?? "";
  elements.eventAllDay.checked = Boolean(calendarEvent?.isAllDay);
  setEventInputTypes(Boolean(calendarEvent?.isAllDay));
  if (calendarEvent) {
    elements.eventStart.value = calendarEvent.isAllDay ? localDateKey(calendarEvent.startsAtUtc) : localDateTimeInput(calendarEvent.startsAtUtc);
    elements.eventEnd.value = calendarEvent.endsAtUtc
      ? (calendarEvent.isAllDay ? localDateKey(calendarEvent.endsAtUtc) : localDateTimeInput(calendarEvent.endsAtUtc))
      : "";
    elements.eventLocation.value = calendarEvent.location ?? "";
    elements.eventDescription.value = calendarEvent.description ?? "";
    elements.eventStatus.value = calendarEvent.status;
  } else {
    const start = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), selectedCalendarDate.getDate(), 9);
    elements.eventStart.value = localDateTimeInput(start);
    elements.eventEnd.value = localDateTimeInput(new Date(start.getTime() + 3_600_000));
    elements.eventStatus.value = "active";
  }
  loadEventRecurrenceEditor(calendarEvent?.recurrenceRule ?? null);
  elements.eventDialog.showModal();
  elements.eventTitle.focus();
}

async function saveEvent(event) {
  event.preventDefault();
  elements.eventFormError.textContent = "";
  const submit = elements.eventForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const allDay = elements.eventAllDay.checked;
    const payload = {
      title: elements.eventTitle.value,
      description: elements.eventDescription.value,
      location: elements.eventLocation.value,
      startsAtUtc: inputToIso(elements.eventStart.value, allDay),
      endsAtUtc: inputToIso(elements.eventEnd.value, allDay),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isAllDay: allDay,
      status: elements.eventStatus.value,
      recurrenceRule: buildEventRecurrenceRule(),
    };
    const id = elements.eventId.value;
    if (id) payload.version = elements.eventVersion.value;
    await api(id ? `/api/calendar-events/${id}` : "/api/calendar-events", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.eventDialog.close();
    await refreshCalendar();
  } catch (error) {
    elements.eventFormError.textContent = error.message || "Could not save the event.";
  } finally {
    submit.disabled = false;
  }
}

async function refreshTodos() {
  try {
    const [body, groupBody] = await Promise.all([
      api(`/api/todos?scope=${encodeURIComponent(elements.todoScope.value)}&limit=1000`),
      api("/api/todo-groups"),
    ]);
    displayedTodos = body.todos;
    todoGroups = groupBody.groups;
    const selectedGroup = elements.todoGroupFilter.value;
    elements.todoGroupFilter.replaceChildren(node("option", "", "All groups"));
    elements.todoGroupFilter.firstElementChild.value = "";
    for (const group of todoGroups) {
      const option = node("option", "", group.name);
      option.value = String(group.id);
      elements.todoGroupFilter.append(option);
    }
    elements.todoGroupFilter.value = todoGroups.some(({ id }) => String(id) === selectedGroup) ? selectedGroup : "";
    renderTodos();
  } catch (error) {
    elements.todoList.replaceChildren(node("p", "empty", error.message || "To-Do List unavailable."));
  }
}

function formatTodoDateTime(value) {
  return formatDisplayDate(value);
}

function renderTodos() {
  elements.todoList.replaceChildren();
  const visibleTodos = elements.todoGroupFilter.value
    ? displayedTodos.filter(({ groupId }) => String(groupId) === elements.todoGroupFilter.value)
    : displayedTodos;
  elements.todoCount.textContent = `${visibleTodos.length} ${visibleTodos.length === 1 ? "task" : "tasks"}`;
  const groupedTodos = new Map();
  const visibleGroups = elements.todoGroupFilter.value
    ? todoGroups.filter(({ id }) => String(id) === elements.todoGroupFilter.value)
    : todoGroups;
  for (const group of visibleGroups) {
    groupedTodos.set(group.id, { name: group.name, archivedAtUtc: group.archivedAtUtc, todos: [] });
  }
  for (const todo of visibleTodos) {
    const group = groupedTodos.get(todo.groupId) ?? {
      name: todo.groupName, archivedAtUtc: todo.groupArchivedAtUtc, todos: [],
    };
    group.todos.push(todo);
    groupedTodos.set(todo.groupId, group);
  }
  if (groupedTodos.size === 0) {
    elements.todoList.append(node("p", "empty", "No to-do groups in this view."));
    return;
  }
  for (const [groupId, group] of groupedTodos) {
    const section = node("section", "todo-group-section");
    section.dataset.groupId = String(groupId);
    const heading = node("header", "todo-group-heading");
    const headingActions = node("div", "todo-group-heading-actions");
    headingActions.append(node("span", "", `${group.todos.length} ${group.todos.length === 1 ? "task" : "tasks"}`));
    if (group.archivedAtUtc) {
      headingActions.append(node("span", "todo-group-archived", "Archived group"));
    } else if (group.name.toLowerCase() !== "inbox") {
      const rename = node("button", "secondary compact", "Rename");
      const archive = node("button", "secondary compact", "Archive group");
      rename.type = "button";
      archive.type = "button";
      rename.addEventListener("click", () => void renameTodoGroup(groupId, group.name));
      archive.addEventListener("click", () => void archiveTodoGroup(groupId, group.name));
      headingActions.append(rename, archive);
    }
    heading.append(node("h3", "", group.name), headingActions);
    const cards = node("div", "todo-group-cards");
    for (const todo of group.todos) {
      const card = node("article", `todo-card ${todo.status === "complete" ? "completed" : ""}`);
      const check = node("button", "todo-check", todo.status === "complete" ? "✓" : "");
      check.type = "button";
      check.setAttribute("aria-label", todo.status === "complete" ? `Reopen ${todo.text}` : `Complete ${todo.text}`);
      check.addEventListener("click", async () => {
        check.disabled = true;
        try {
          await api(`/api/todos/${todo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: todo.version, status: todo.status === "complete" ? "todo" : "complete" }),
          });
          await refreshTodos();
          if (activeView === "calendar") await refreshCalendar();
        } catch (error) {
          window.alert(error.message || "Could not update the todo.");
          check.disabled = false;
        }
      });
      const body = node("div", "todo-body");
      body.append(node("h3", "", todo.text));
      const metadata = node("div", "todo-meta");
      if (todo.sequence != null) metadata.append(node("span", "todo-pill", `#${todo.sequence}`));
      metadata.append(node("span", "todo-pill", todo.status.replaceAll("_", " ")));
      if (todo.scheduledAtUtc) {
        metadata.append(node(
          "span",
          "todo-pill",
          `scheduled ${formatDisplayDate(todo.scheduledAtUtc, { includeTime: !todo.isAllDay })}`,
        ));
      }
      if (todo.dueAtUtc) {
        const due = new Date(todo.dueAtUtc);
        metadata.append(node("span", `todo-pill ${todo.status !== "complete" && due < new Date() ? "overdue" : ""}`, `due ${formatTodoDateTime(due)}`));
      }
      if (todo.recurrenceRule) metadata.append(node("span", "todo-pill", describeTodoRecurrence(todo.recurrenceRule)));
      body.append(metadata);
      const actions = node("div", "todo-actions");
      const schedule = node("button", "secondary compact", todo.scheduledAtUtc ? "Reschedule" : "Schedule");
      const top = node("button", "secondary compact", "⇈");
      const up = node("button", "secondary compact", "↑");
      const down = node("button", "secondary compact", "↓");
      const bottom = node("button", "secondary compact", "⇊");
      const edit = node("button", "secondary compact", "Edit");
      schedule.type = top.type = up.type = down.type = bottom.type = edit.type = "button";
      schedule.title = todo.scheduledAtUtc ? "Choose a new day on the calendar" : "Choose a day on the calendar";
      top.title = "Move task to top of group";
      up.title = "Move task up";
      down.title = "Move task down";
      bottom.title = "Move task to bottom of group";
      top.setAttribute("aria-label", `Move ${todo.text} to top of group`);
      up.setAttribute("aria-label", `Move ${todo.text} up`);
      down.setAttribute("aria-label", `Move ${todo.text} down`);
      bottom.setAttribute("aria-label", `Move ${todo.text} to bottom of group`);
      schedule.addEventListener("click", () => beginCalendarScheduling(todo));
      top.addEventListener("click", () => void moveTodo(todo, "top", visibleTodos));
      up.addEventListener("click", () => void moveTodo(todo, "up", visibleTodos));
      down.addEventListener("click", () => void moveTodo(todo, "down", visibleTodos));
      bottom.addEventListener("click", () => void moveTodo(todo, "bottom", visibleTodos));
      edit.addEventListener("click", () => openTodoEditor(todo));
      if (["todo", "ai_suggested"].includes(todo.status)) actions.append(schedule);
      actions.append(top, up, down, bottom, edit);
      card.append(check, body, actions);
      cards.append(card);
    }
    section.append(heading, cards);
    elements.todoList.append(section);
  }
}

async function moveTodo(todo, movement, visibleTodos) {
  const groupTodos = visibleTodos.filter(({ groupId }) => groupId === todo.groupId);
  const currentIndex = groupTodos.findIndex(({ id }) => id === todo.id);
  const targetIndex = movement === "top"
    ? 0
    : movement === "bottom"
      ? groupTodos.length - 1
      : currentIndex + (movement === "up" ? -1 : 1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= groupTodos.length || targetIndex === currentIndex) return;
  const orderedTodoIds = groupTodos.map(({ id }) => id);
  orderedTodoIds.splice(currentIndex, 1);
  orderedTodoIds.splice(targetIndex, 0, todo.id);
  try {
    await api(`/api/todo-groups/${todo.groupId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedTodoIds }),
    });
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not reorder the task.");
  }
}

function openTodoEditor(todo = null) {
  elements.todoForm.reset();
  elements.todoFormError.textContent = "";
  elements.todoDialogTitle.textContent = todo ? "Edit todo" : "New todo";
  elements.todoId.value = todo?.id ?? "";
  elements.todoVersion.value = todo?.version ?? "";
  populateTodoGroupEditor(todo?.groupId ?? (elements.todoGroupFilter.value || todoGroups[0]?.id || ""));
  elements.todoText.value = todo?.text ?? "";
  elements.todoSequence.value = todo?.sequence ?? "";
  elements.todoAllDay.checked = Boolean(todo?.isAllDay);
  setTodoScheduledInputType(elements.todoAllDay.checked);
  elements.todoScheduled.value = todo?.scheduledAtUtc
    ? (todo.isAllDay ? localDateKey(todo.scheduledAtUtc) : localDateTimeInput(todo.scheduledAtUtc))
    : "";
  elements.todoDue.value = localDateTimeInput(todo?.dueAtUtc);
  elements.todoStatus.value = todo?.status ?? "todo";
  loadTodoRecurrenceEditor(todo?.recurrenceRule ?? null, todo?.recurrenceTimeZone ?? null);
  elements.todoDialog.showModal();
  elements.todoText.focus();
}

function populateTodoGroupEditor(selectedGroupId) {
  elements.todoGroup.replaceChildren();
  for (const group of todoGroups) {
    const option = node("option", "", group.name);
    option.value = String(group.id);
    elements.todoGroup.append(option);
  }
  elements.todoGroup.value = String(selectedGroupId ?? "");
}

async function saveTodo(event) {
  event.preventDefault();
  elements.todoFormError.textContent = "";
  const submit = elements.todoForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const payload = {
      text: elements.todoText.value,
      groupId: Number(elements.todoGroup.value),
      sequence: elements.todoSequence.value ? Number(elements.todoSequence.value) : null,
      scheduledAtUtc: inputToIso(elements.todoScheduled.value, elements.todoAllDay.checked),
      isAllDay: elements.todoAllDay.checked && Boolean(elements.todoScheduled.value),
      dueAtUtc: inputToIso(elements.todoDue.value),
      status: elements.todoStatus.value,
    };
    if (todoRecurrenceDirty) {
      payload.recurrenceRule = buildTodoRecurrenceRule();
      payload.recurrenceTimeZone = payload.recurrenceRule
        ? (loadedTodoRecurrenceTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        : null;
    }
    const id = elements.todoId.value;
    if (id) payload.version = elements.todoVersion.value;
    await api(id ? `/api/todos/${id}` : "/api/todos", {
      method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    elements.todoDialog.close();
    if (activeView === "calendar") await refreshCalendar();
    else await refreshTodos();
  } catch (error) {
    elements.todoFormError.textContent = error.message || "Could not save the todo.";
  } finally {
    submit.disabled = false;
  }
}

async function createTodoGroup({ selectFilter = true } = {}) {
  const name = window.prompt("Name the new to-do group:")?.trim();
  if (!name) return null;
  try {
    const body = await api("/api/todo-groups", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await refreshTodos();
    if (selectFilter) {
      elements.todoGroupFilter.value = String(body.group.id);
      renderTodos();
    }
    return body.group;
  } catch (error) {
    window.alert(error.message || "Could not create the group.");
    return null;
  }
}

async function archiveTodoGroup(groupId, groupName) {
  const confirmed = window.confirm(
    `Archive the ${groupName} group? This fails if it has active tasks. Terminal tasks will retain this historical group.`,
  );
  if (!confirmed) return;
  try {
    const result = await api(`/api/todo-groups/${groupId}/archive`, { method: "POST" });
    const retained = result.retainedTerminalTaskCount
      ? ` ${result.retainedTerminalTaskCount} terminal ${result.retainedTerminalTaskCount === 1 ? "task retains" : "tasks retain"} this historical group.`
      : "";
    elements.status.textContent = `${groupName} was archived.${retained}`;
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not archive the group.");
  }
}

async function renameTodoGroup(groupId, currentName) {
  const name = window.prompt("New name for this to-do group:", currentName)?.trim();
  if (!name || name === currentName) return;
  try {
    const result = await api(`/api/todo-groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    elements.status.textContent = `${result.group.previousName} was renamed to ${result.group.name}.`;
    await refreshTodos();
    if (activeView === "calendar") await refreshCalendar();
  } catch (error) {
    window.alert(error.message || "Could not rename the group.");
  }
}

async function refreshLogs() {
  try {
    const [trackerBody, entryBody] = await Promise.all([
      api("/api/log-trackers?limit=500"),
      api("/api/log-entries?limit=500"),
    ]);
    logTrackers = trackerBody.trackers;
    logEntries = entryBody.entries;
    populateLogFilters();
    renderLogs();
  } catch (error) {
    elements.logList.replaceChildren(node("p", "empty", error.message || "Logs unavailable."));
  }
}

function logGroups() {
  const groups = new Map();
  for (const tracker of logTrackers) groups.set(tracker.groupId, tracker.groupName);
  return [...groups].sort((left, right) => left[1].localeCompare(right[1]));
}

function populateLogFilters() {
  const selectedGroup = elements.logGroupFilter.value;
  const selectedTracker = elements.logTrackerFilter.value;
  elements.logGroupFilter.replaceChildren(node("option", "", "All groups"));
  elements.logGroupFilter.firstElementChild.value = "";
  for (const [groupId, name] of logGroups()) {
    const option = node("option", "", name);
    option.value = String(groupId);
    elements.logGroupFilter.append(option);
  }
  elements.logGroupFilter.value = selectedGroup;
  if (!elements.logGroupFilter.value) elements.logGroupFilter.value = "";
  populateLogTrackerFilter(selectedTracker);
}

function populateLogTrackerFilter(selectedTracker = elements.logTrackerFilter.value) {
  const groupId = Number(elements.logGroupFilter.value) || null;
  const visibleTrackers = logTrackers.filter((tracker) => groupId === null || tracker.groupId === groupId);
  elements.logTrackerFilter.replaceChildren(node("option", "", "All trackers"));
  elements.logTrackerFilter.firstElementChild.value = "";
  for (const tracker of visibleTrackers) {
    const option = node("option", "", tracker.name);
    option.value = String(tracker.id);
    elements.logTrackerFilter.append(option);
  }
  elements.logTrackerFilter.value = selectedTracker;
  if (!elements.logTrackerFilter.value) elements.logTrackerFilter.value = "";
}

function renderLogs() {
  elements.logList.replaceChildren();
  const selectedGroupId = Number(elements.logGroupFilter.value) || null;
  const selectedTrackerId = Number(elements.logTrackerFilter.value) || null;
  const visibleTrackers = logTrackers.filter((tracker) => (
    (selectedGroupId === null || tracker.groupId === selectedGroupId)
    && (selectedTrackerId === null || tracker.id === selectedTrackerId)
  ));
  const visibleTrackerIds = new Set(visibleTrackers.map(({ id }) => id));
  const visibleEntries = logEntries.filter(({ trackerId }) => visibleTrackerIds.has(trackerId));
  const totalEntries = visibleTrackers.reduce((total, tracker) => total + tracker.entryCount, 0);
  elements.logCount.textContent = `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"} · ${visibleTrackers.length} ${visibleTrackers.length === 1 ? "tracker" : "trackers"}`;
  if (visibleTrackers.length === 0) {
    elements.logList.append(node("p", "empty", "No trackers in this view. Add an entry to create one."));
    return;
  }

  const grouped = new Map();
  for (const tracker of visibleTrackers) {
    const group = grouped.get(tracker.groupId) ?? { name: tracker.groupName, trackers: [] };
    group.trackers.push(tracker);
    grouped.set(tracker.groupId, group);
  }
  for (const [, group] of grouped) {
    const section = node("section", "log-group-section");
    const heading = node("header", "log-group-heading");
    heading.append(
      node("h3", "", group.name),
      node("span", "", `${group.trackers.length} ${group.trackers.length === 1 ? "tracker" : "trackers"}`),
    );
    const cards = node("div", "log-tracker-grid");
    for (const tracker of group.trackers) {
      const card = node("article", "log-tracker-card");
      const cardHeading = node("header", "log-tracker-heading");
      const headingText = node("div");
      headingText.append(node("h4", "", tracker.name));
      const trackerMeta = node("p", "log-tracker-meta");
      trackerMeta.textContent = `${tracker.entryCount} ${tracker.entryCount === 1 ? "entry" : "entries"}`
        + (tracker.defaultUnit ? ` · default ${tracker.defaultUnit}` : "");
      headingText.append(trackerMeta);
      const add = node("button", "secondary compact", "Log entry");
      add.type = "button";
      add.addEventListener("click", () => openLogEditor(tracker.id));
      cardHeading.append(headingText, add);
      const entries = visibleEntries.filter(({ trackerId }) => trackerId === tracker.id);
      const entryList = node("div", "log-entry-list");
      if (entries.length === 0) {
        entryList.append(node("p", "empty", "No recent entries."));
      } else {
        for (const entry of entries) {
          const item = node("article", "log-entry");
          const metadata = node("div", "log-entry-meta");
          metadata.append(node("time", "", formatDisplayDate(entry.occurredAtUtc)));
          if (entry.numberValue !== null) {
            metadata.append(node("span", "log-value", `${entry.numberValue}${entry.unit ? ` ${entry.unit}` : ""}`));
          }
          item.append(metadata, node("p", "", entry.contentText));
          entryList.append(item);
        }
      }
      card.append(cardHeading, entryList);
      cards.append(card);
    }
    section.append(heading, cards);
    elements.logList.append(section);
  }
}

function populateLogTrackerEditor(selectedTrackerId = null) {
  elements.logTracker.replaceChildren();
  for (const [groupId, groupName] of logGroups()) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;
    for (const tracker of logTrackers.filter((item) => item.groupId === groupId)) {
      const option = node("option", "", tracker.name);
      option.value = String(tracker.id);
      optgroup.append(option);
    }
    elements.logTracker.append(optgroup);
  }
  const newOption = node("option", "", "Create a new tracker…");
  newOption.value = "new";
  elements.logTracker.append(newOption);
  elements.logTracker.value = selectedTrackerId == null ? "new" : String(selectedTrackerId);
  if (!elements.logTracker.value) elements.logTracker.value = "new";

  elements.logGroupOptions.replaceChildren();
  for (const [, name] of logGroups()) {
    const option = document.createElement("option");
    option.value = name;
    elements.logGroupOptions.append(option);
  }
  updateLogTrackerEditor();
}

function updateLogTrackerEditor() {
  const isNew = elements.logTracker.value === "new";
  elements.newLogTrackerFields.hidden = !isNew;
  elements.logTrackerName.required = isNew;
  elements.logGroupName.required = isNew;
  const tracker = logTrackers.find(({ id }) => id === Number(elements.logTracker.value));
  elements.logUnit.placeholder = tracker?.defaultUnit ? `Defaults to ${tracker.defaultUnit}` : "";
}

function openLogEditor(trackerId = null) {
  elements.logForm.reset();
  elements.logFormError.textContent = "";
  elements.logOccurred.value = localDateTimeInput(new Date());
  elements.logGroupName.value = "General";
  populateLogTrackerEditor(trackerId);
  elements.logDialog.showModal();
  (trackerId == null ? elements.logTrackerName : elements.logContent).focus();
}

async function saveLogEntry(event) {
  event.preventDefault();
  elements.logFormError.textContent = "";
  const submit = elements.logForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const creatingTracker = elements.logTracker.value === "new";
    const payload = {
      trackerId: creatingTracker ? null : Number(elements.logTracker.value),
      trackerName: creatingTracker ? elements.logTrackerName.value : null,
      groupName: creatingTracker ? elements.logGroupName.value : null,
      contentText: elements.logContent.value,
      numberValue: elements.logNumber.value === "" ? null : Number(elements.logNumber.value),
      unit: elements.logUnit.value || null,
      occurredAtUtc: inputToIso(elements.logOccurred.value),
    };
    await api("/api/log-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.logDialog.close();
    await refreshLogs();
  } catch (error) {
    elements.logFormError.textContent = error.message || "Could not save the log entry.";
  } finally {
    submit.disabled = false;
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

elements.text.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!elements.send.disabled) elements.form.requestSubmit();
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
elements.integrationsButton.addEventListener("click", () => elements.integrationsDialog.showModal());
elements.integrationList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-name]");
  if (!button || !elements.integrationList.contains(button)) return;
  const name = button.dataset.name;
  button.disabled = true;
  try {
    if (button.classList.contains("disconnect-integration")) {
      if (!window.confirm(`Disconnect ${name}? Agent Slayer will delete its local OAuth credentials and remove the provider's tools.`)) return;
      await api(`/api/integrations/${encodeURIComponent(name)}/oauth/disconnect`, { method: "POST" });
      elements.status.textContent = `${name} disconnected locally.`;
      await loadHealth();
    } else {
      elements.status.textContent = `Starting ${name} authorization…`;
      const result = await api(`/api/integrations/${encodeURIComponent(name)}/oauth/start`, { method: "POST" });
      window.location.assign(result.authorizationUrl);
    }
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    button.disabled = false;
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
for (const button of elements.navButtons) button.addEventListener("click", () => switchView(button.dataset.view));
elements.previousMonth.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  selectedCalendarDate = new Date(calendarCursor);
  void refreshCalendar();
});
elements.nextMonth.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  selectedCalendarDate = new Date(calendarCursor);
  void refreshCalendar();
});
elements.today.addEventListener("click", () => {
  selectedCalendarDate = new Date();
  calendarCursor = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
  void refreshCalendar();
});
elements.cancelCalendarSchedule.addEventListener("click", () => cancelCalendarScheduling());
elements.newEvent.addEventListener("click", () => openEventEditor());
elements.eventAllDay.addEventListener("change", () => {
  setEventInputTypes(elements.eventAllDay.checked);
  updateEventRecurrenceEditor();
});
elements.eventForm.addEventListener("submit", saveEvent);
for (const control of [
  elements.eventRepeatEnabled, elements.eventRepeatInterval, elements.eventRepeatFrequency,
  elements.eventRepeatEnd, elements.eventRepeatCount, elements.eventRepeatUntil,
  ...elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]'),
]) {
  control.addEventListener("change", updateEventRecurrenceEditor);
  if (control.matches('input[type="number"]')) control.addEventListener("input", updateEventRecurrenceEditor);
}
elements.eventStart.addEventListener("change", updateEventRecurrenceEditor);
elements.newTodo.addEventListener("click", async () => {
  if (todoGroups.length === 0) await refreshTodos();
  openTodoEditor();
});
elements.newTodoGroup.addEventListener("click", () => void createTodoGroup());
elements.todoNewGroup.addEventListener("click", async () => {
  const group = await createTodoGroup({ selectFilter: false });
  if (group) populateTodoGroupEditor(group.id);
});
elements.todoScope.addEventListener("change", () => void refreshTodos());
elements.todoGroupFilter.addEventListener("change", renderTodos);
elements.todoForm.addEventListener("submit", saveTodo);
elements.todoAllDay.addEventListener("change", () => {
  setTodoScheduledInputType(elements.todoAllDay.checked);
  updateTodoRecurrenceEditor();
});
for (const control of [
  elements.todoRepeatEnabled, elements.todoRepeatInterval, elements.todoRepeatFrequency,
  elements.todoRepeatEnd, elements.todoRepeatCount, elements.todoRepeatUntil,
  ...elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]'),
]) {
  const recurrenceChanged = () => {
    todoRecurrenceDirty = true;
    updateTodoRecurrenceEditor();
  };
  control.addEventListener("change", recurrenceChanged);
  if (control.matches('input[type="number"]')) control.addEventListener("input", recurrenceChanged);
}
elements.todoScheduled.addEventListener("change", updateTodoRecurrenceEditor);
elements.newLogEntry.addEventListener("click", () => openLogEditor());
elements.logGroupFilter.addEventListener("change", () => {
  populateLogTrackerFilter("");
  renderLogs();
});
elements.logTrackerFilter.addEventListener("change", renderLogs);
elements.logTracker.addEventListener("change", updateLogTrackerEditor);
elements.logForm.addEventListener("submit", saveLogEntry);
for (const button of document.querySelectorAll(".dialog-close")) {
  button.addEventListener("click", () => button.closest("dialog")?.close());
}

if (!accessToken) elements.tokenDialog.showModal();
if (new URLSearchParams(window.location.search).get("oauth") === "connected") {
  elements.status.textContent = "MCP OAuth connected.";
  history.replaceState(null, "", window.location.pathname);
}
loadHealth().catch(() => {});
loadRequests({ force: true }).catch(() => {});
switchView("agent");
setInterval(() => loadHealth().catch(() => {}), 5000);
setInterval(() => loadRequests().catch(() => {}), 1500);
setInterval(updateProgressClocks, 250);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
